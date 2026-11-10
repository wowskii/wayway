// The only file that talks to the LLM provider (OpenRouter, chat completions format).
// callTool forces a structured output (tool call), validates it with code,
// and retries ONCE with the validation errors ("generate, then verify").
//
// Every failure (provider down, timeout, missing key, invalid output, validator bug)
// ends as an AIOutputError, so each caller's fallback always applies: the app never
// crashes because of the model.

import { DEBUG, LIMITS, OPENROUTER } from "./config";
import { PROMPT_VERSION } from "./prompts";

export type JsonSchema = Record<string, unknown>;

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface ToolCall<T> {
  model: string;
  temperature: number;
  maxTokens: number;
  system: string;               // developer prompt: rules, highest priority we control
  user: string;                 // structured context (XML tags), filled from a template
  tool: { name: string; description: string; schema: JsonSchema };
  validate: (raw: unknown) => Validation<T>;
}

export interface ToolResult<T> {
  value: T;
  promptVersion: string;        // logged so the report can compare prompt versions
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

// kind tells the route/logs WHY the call failed:
//   "invalid_output": the model answered, but not validly (even after the retry)
//   "provider":       network error, HTTP error, timeout, missing key
//   "internal":       bug in our validator (logged, never shown to users)
export type AIErrorKind = "invalid_output" | "provider" | "internal";

export class AIOutputError extends Error {
  constructor(public tool: string, public errors: string[], public kind: AIErrorKind = "invalid_output") {
    super(`${tool} (${kind}): ${errors.join("; ")}`);
  }
}

// ---------- Provider adapter ----------
// Normalized answer of one call, so tests can inject a fake model (scripts/mock.ts).
export interface ChatResult {
  toolCall: { id: string; arguments: string } | null;   // arguments = JSON string
  assistantMessage: unknown;                             // appended to the history on retry
  truncated: boolean;                                    // finish_reason === "length"
  usage: { input: number; output: number };
}

export interface LLMClient {
  chat(body: Record<string, any>): Promise<ChatResult>;
}

const openRouterClient: LLMClient = {
  async chat(body) {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Missing OPENROUTER_API_KEY (see .env.example)");
    const res = await fetch(`${OPENROUTER.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": OPENROUTER.appName,     // optional: shows the app name in OpenRouter's dashboard
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LIMITS.requestTimeoutMs),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data: any = await res.json();
    if (data.error) throw new Error(`OpenRouter error: ${JSON.stringify(data.error).slice(0, 300)}`);
    const choice = data.choices?.[0] ?? {};
    const message = choice.message ?? {};
    const call = message.tool_calls?.[0];
    return {
      toolCall: call ? { id: call.id, arguments: call.function?.arguments ?? "" } : null,
      assistantMessage: message,
      truncated: choice.finish_reason === "length",
      usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
    };
  },
};

let client: LLMClient = openRouterClient;
export function setClient(c: LLMClient) {
  client = c;
}

// ---------- Structured call with validation and one retry ----------
export async function callTool<T>(call: ToolCall<T>): Promise<ToolResult<T>> {
  const started = Date.now();
  const base: any[] = [
    { role: "system", content: call.system },
    { role: "user", content: call.user },
  ];
  let messages = base;
  let maxTokens = call.maxTokens;
  let inputTokens = 0;
  let outputTokens = 0;
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= LIMITS.maxRetries + 1; attempt++) {
    let res: ChatResult;
    try {
      res = await client.chat({
        model: call.model,
        max_tokens: maxTokens,
        temperature: call.temperature,
        messages,
        tools: [{
          type: "function",
          function: { name: call.tool.name, description: call.tool.description, parameters: call.tool.schema },
        }],
        tool_choice: { type: "function", function: { name: call.tool.name } },
      });
    } catch (e) {
      // Provider problem: retrying immediately rarely helps, let the caller's fallback act.
      const reason = e instanceof Error ? e.message : String(e);
      if (DEBUG) console.log(`[llm] ${call.tool.name} attempt ${attempt}: provider error: ${reason}`);
      throw new AIOutputError(call.tool.name, [reason], "provider");
    }
    inputTokens += res.usage.input;
    outputTokens += res.usage.output;

    // 1) Get parseable arguments. Problems here restart from the clean prompt:
    //    a cut or broken tool call cannot be sent back to the model as history.
    let parsed: unknown;
    let restartNote: string | null = null;
    if (res.truncated) {
      restartNote = "Your previous answer was cut off because it was too long. Be more concise: short reasoning, short explanations.";
      maxTokens = call.maxTokens * 2;
    } else if (!res.toolCall) {
      restartNote = `You must answer by calling the tool ${call.tool.name}.`;
    } else {
      try {
        parsed = JSON.parse(res.toolCall.arguments);
      } catch {
        restartNote = `Your previous tool arguments were not valid JSON. Call ${call.tool.name} again with valid JSON.`;
      }
    }

    if (restartNote) {
      lastErrors = [restartNote];
      if (DEBUG) console.log(`[llm ${PROMPT_VERSION}] ${call.tool.name} attempt ${attempt} (${call.model}):`, restartNote);
      messages = [...base, { role: "user", content: restartNote }];
      continue;
    }

    // 2) Validate with code. A crash here is OUR bug, not the model's: do not retry.
    let check: Validation<T>;
    try {
      check = call.validate(parsed);
    } catch (e) {
      console.error(`[llm] ${call.tool.name}: validator crashed`, e);
      throw new AIOutputError(call.tool.name, [`validator crashed: ${e instanceof Error ? e.message : e}`], "internal");
    }

    if (DEBUG) {
      console.log(`[llm ${PROMPT_VERSION}] ${call.tool.name} attempt ${attempt} (${call.model}):`, check.ok ? "valid" : check.errors);
    }
    if (check.ok) {
      return { value: check.value, promptVersion: PROMPT_VERSION, attempts: attempt, inputTokens, outputTokens, ms: Date.now() - started };
    }

    // 3) Retry: show the model its own output and the exact errors to fix.
    lastErrors = check.errors;
    messages = [
      ...base,
      res.assistantMessage,
      {
        role: "tool",
        tool_call_id: res.toolCall!.id,
        content: `Your output was rejected by our validator. Fix ONLY these problems and call ${call.tool.name} again:\n- ${check.errors.join("\n- ")}`,
      },
    ];
  }
  throw new AIOutputError(call.tool.name, lastErrors);
}
