"use client";
// The onboarding interview: a private chat with WayWay.
// Runs in the browser. Talks to the server only through the API routes:
//   POST /api/private          send a message, get WayWay's reply
//   POST /api/private/confirm  answer a confirmation card
//   POST /api/private/finish   end the interview
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { HardConstraints } from "@/contracts/contract";
import type { InterviewProgress } from "@/lib/ai/types";
import type { ConfirmResponse, InterviewMessage, InterviewTurnResponse } from "@/lib/interview/types";
import { Button } from "@/components/ui";
import { ConstraintCard } from "./ConstraintCard";
import { MessageBubble, TypingBubble } from "./MessageBubble";
import { TopicProgress } from "./TopicProgress";

const MAX_LENGTH = 1000;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Something went wrong. Please try again.");
  return json as T;
}

export function InterviewChat({
  tripId,
  memberId,
  initialMessages,
  initialProgress,
  initiallyFinished,
}: {
  tripId: string;
  memberId: string;
  initialMessages: InterviewMessage[];
  initialProgress: InterviewProgress;
  initiallyFinished: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [progress, setProgress] = useState(initialProgress);
  const [finished, setFinished] = useState(initiallyFinished);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const pendingCards = messages.some((m) => m.constraintsStatus === "pending");
  const canFinish = progress.done && !pendingCards && !finished;

  // Keep the latest message in view
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, sending]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    // Show the message right away (optimistic), replace it with the saved one after
    const tempId = `temp-${Date.now()}`;
    const temp: InterviewMessage = {
      id: tempId, tripId, memberId, sender: "member", text, createdAt: new Date().toISOString(), round: 0,
    };
    setMessages((m) => [...m, temp]);
    setDraft("");
    setSending(true);
    setError(null);
    try {
      const res = await postJson<InterviewTurnResponse>("/api/private", {
        tripId, memberId, message: { ...temp, id: undefined },
      });
      setMessages((m) => [...m.filter((x) => x.id !== tempId), ...res.messages]);
      setProgress(res.interview);
    } catch (err) {
      setMessages((m) => m.filter((x) => x.id !== tempId));
      setDraft(text);   // give the text back so nothing is lost
      setError((err as Error).message);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  async function answerCard(messageId: string, decision: "confirm" | "reject", edited?: Partial<HardConstraints>) {
    setError(null);
    try {
      const res = await postJson<ConfirmResponse>("/api/private/confirm", {
        tripId, messageId, decision, ...(edited ? { constraints: edited } : {}),
      });
      setMessages((m) => m.map((x) => (x.id === messageId ? res.message : x)));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function finish() {
    setError(null);
    try {
      await postJson("/api/private/finish", { tripId });
      setFinished(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Enter sends, Shift+Enter makes a new line
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="flex h-[calc(100dvh-4rem-1px)] flex-col">
      {/* Top: what this screen is + progress */}
      <div className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold">Get to know you</h1>
              <p className="text-sm text-muted">🔒 Only WayWay sees this chat, never your group.</p>
            </div>
            {canFinish && <Button onClick={finish} className="h-9 shrink-0">Finish</Button>}
          </div>
          <TopicProgress covered={progress.covered} />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto" aria-live="polite">
        <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
          {messages.map((m) => (
            <div key={m.id} className="flex flex-col gap-2">
              <MessageBubble sender={m.sender} pending={m.id.startsWith("temp-")}>
                {m.text}
              </MessageBubble>
              {m.constraintsToConfirm && m.constraintsStatus && (
                <ConstraintCard
                  constraints={m.constraintsToConfirm}
                  status={m.constraintsStatus}
                  onAnswer={(decision, edited) => answerCard(m.id, decision, edited)}
                />
              )}
            </div>
          ))}
          {sending && <TypingBubble />}
          {finished && (
            <div className="rounded-2xl border border-brand/30 bg-brand-soft p-4 text-sm">
              <p className="font-medium text-brand">You&apos;re all set!</p>
              <p className="mt-1">
                WayWay will use this to suggest plans for your group. You can keep chatting here anytime to add more.
              </p>
              <Link href="/" className="mt-3 inline-block font-medium text-brand hover:underline">
                Back to my trips →
              </Link>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-line bg-card">
        <form onSubmit={send} className="mx-auto flex max-w-2xl flex-col gap-2 px-4 py-3">
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {pendingCards && progress.done && !finished && (
            <p className="text-xs text-muted">Answer the card above to finish.</p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type your answer…"
              aria-label="Your message to WayWay"
              rows={1}
              maxLength={MAX_LENGTH}
              autoFocus
              className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-line bg-page px-3 py-2.5 text-[15px] outline-none focus:border-brand focus:bg-card"
            />
            <Button type="submit" disabled={sending || !draft.trim()} aria-label="Send" className="h-11 w-11 px-0">
              ↑
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
