import "server-only";
// Per-member limit on messages that make an AI call. The OpenRouter key is shared by the whole team, so one
// member spamming @WayWay or the private chat must not burn it. Counted from the member's own rows already
// in the database (no new table; works across tabs, devices and server restarts). Checked BEFORE the
// message is saved, so a refused message costs nothing and is not stored.
import { InterviewError } from "@/lib/interview/service";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export const AI_LIMITS = {
  chat: { perMinute: 4, perHour: 30 },      // @WayWay messages in the group chat
  private: { perMinute: 6, perHour: 60 },   // private chat: interview + feedback on the options
} as const;

export async function checkAiLimit(admin: Admin, kind: keyof typeof AI_LIMITS, memberId: string): Promise<void> {
  const count = async (ms: number) => {
    const since = new Date(Date.now() - ms).toISOString();
    const query = kind === "chat"
      ? admin.from("chat_messages").select("id", { count: "exact", head: true })
          .eq("sender_member_id", memberId).ilike("text", "%@wayway%").gte("created_at", since)
      : admin.from("private_messages").select("id", { count: "exact", head: true })
          .eq("member_id", memberId).eq("sender", "member").gte("created_at", since);
    const { count: n, error } = await query;
    if (error) throw new InterviewError(500, "Could not send your message. Try again.");
    return n ?? 0;
  };
  const limit = AI_LIMITS[kind];
  const [minute, hour] = await Promise.all([count(60_000), count(3_600_000)]);
  if (minute >= limit.perMinute) throw new InterviewError(429, "WayWay needs a short break. Try again in a minute.");
  if (hour >= limit.perHour) throw new InterviewError(429, "That's a lot of messages to WayWay this hour. Try again a bit later.");
}
