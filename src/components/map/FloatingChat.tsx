"use client";
// The group chat as a floating window on the map page (like Instagram's messages on desktop):
// a round green button at the bottom right, closed by default. Tap = open the window, tap again
// (or ✕, or Escape) = close it. The window is Patrick's <GroupChat>, unchanged.
//
// Why the chat is only mounted while open: <GroupChat> marks messages as read when its list is at the
// bottom and the page is visible. Hidden but mounted, it would mark them read without anyone seeing them.
// So it mounts on open, with fresh messages from the server (openChatWindow), and unmounts on close.
// While closed, a small Realtime subscription only counts new messages for the red badge.
import { useCallback, useEffect, useState } from "react";
import { openChatWindow } from "@/app/trips/[tripId]/map/actions";
import { GroupChat } from "@/components/chatbox-chat/GroupChat";
import type { ChatWindowData } from "@/lib/chat-window";
import { createClient } from "@/lib/supabase/client";

export function FloatingChat({ tripId, myMemberId, initialUnread }: { tripId: string; myMemberId: string; initialUnread: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ChatWindowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [unread, setUnread] = useState(initialUnread);

  const show = useCallback(async () => {
    setOpen(true);
    setUnread(0);
    setLoading(true);
    setFailed(false);
    try {
      const fresh = await openChatWindow(tripId);
      setData(fresh);
      setFailed(!fresh);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [tripId]);
  const hide = useCallback(() => {
    setOpen(false);
    setData(null);
  }, []);

  // Escape closes the window
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hide]);

  // Closed: count new messages from others (and WayWay) for the badge
  useEffect(() => {
    if (open) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`map-chat-badge:${tripId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `trip_id=eq.${tripId}` },
        (payload) => {
          if ((payload.new as { sender_member_id: string | null }).sender_member_id !== myMemberId) setUnread((n) => n + 1);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [open, tripId, myMemberId]);

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="Group chat"
          className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-card sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(600px,calc(100dvh-8rem))] sm:w-[380px] sm:rounded-2xl sm:border sm:border-line sm:shadow-2xl"
        >
          {data ? (
            <GroupChat
              tripId={tripId}
              tripName={data.tripName}
              timezone={data.timezone}
              me={data.me}
              members={data.members}
              initialMessages={data.messages}
              initialReads={data.reads}
              headerActions={<CloseButton onClick={hide} />}
            />
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex justify-end border-b border-line p-2">
                <CloseButton onClick={hide} />
              </div>
              <p className="m-auto px-6 text-center text-sm text-muted">
                {loading ? "Loading the chat…" : failed ? "The chat can't load right now. Close it and try again." : null}
              </p>
            </div>
          )}
        </div>
      )}

      {/* The button stays visible on desktop to close the window; on phones the window covers the screen and has its ✕ */}
      <button
        type="button"
        onClick={open ? hide : show}
        aria-expanded={open}
        aria-label={open ? "Close the group chat" : `Open the group chat${unread ? `, ${unread} new` : ""}`}
        title={open ? "Close the group chat" : "Group chat"}
        className={`fixed bottom-6 right-6 z-50 grid h-14 w-14 place-items-center rounded-full bg-brand text-white shadow-lg transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/30 ${open ? "max-sm:hidden" : ""}`}
      >
        {open ? (
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.5-4.6A8.4 8.4 0 0 1 3 11.5 8.6 8.6 0 0 1 12 3a8.6 8.6 0 0 1 9 8.5z" />
          </svg>
        )}
        {!open && unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-6 min-w-6 place-items-center rounded-full bg-red-500 px-1.5 text-xs font-semibold tabular-nums text-white ring-2 ring-card">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close the group chat"
      title="Close"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
