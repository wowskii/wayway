// AI configuration: change a model in one line.
// Models are called through OpenRouter (key provided by the course).
// Only lib/ai/llm.ts talks to the API.

export const OPENROUTER = {
  baseUrl: "https://openrouter.ai/api/v1",
  appName: "WayWay",
} as const;

// OpenRouter model ids ("provider/model"); any model supporting tool calls works.
export const MODELS = {
  // generateOptions, reviseOptions: reasoning over several constraints
  reasoning: process.env.WAYWAY_MODEL_REASONING || "anthropic/claude-sonnet-5.5",
  // extractPreferences, writeMessage: simple, frequent, must be fast
  fast: process.env.WAYWAY_MODEL_FAST || "anthropic/claude-haiku-5.5",
} as const;

export const TEMPERATURE = {
  extract: 0.0,   // stable extraction
  options: 0.3,   // some variety between candidates, but stable estimates
  message: 0.6,   // natural chat messages
} as const;

// Output budget per task. Options need room for reasoning + up to 5 candidates x every member.
// If an answer is cut off (finish_reason "length"), the retry gets twice this budget.
export const MAX_TOKENS = {
  extract: 1000,
  options: 4000,
  message: 600,
  slot: 500,
} as const;

export const LIMITS = {
  requestTimeoutMs: 60_000,    // abort a provider call that hangs
  recentChatMessages: 20,      // context selection: only the last 20 group messages
  maxStatementsPerMember: 8,   // context compression: short preference statements
  minCandidates: 2,            // fewer valid candidates than this triggers a retry
  maxCandidates: 5,
  maxRetries: 1,               // one retry with the validation errors, then fallback
  slotSlackMin: 15,            // tolerance when checking that visits fit the time slot
} as const;

export const DEBUG = process.env.WAYWAY_DEBUG === "1";
