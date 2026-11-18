// Small chips showing which topics WayWay already knows about. Green + check = covered.
import { INTERVIEW_TOPICS, type InterviewTopic } from "@/lib/ai/types";

const LABELS: Record<InterviewTopic, string> = {
  interests: "Interests",
  pace: "Pace",
  sleep: "Sleep",
  diet: "Diet",
  allergies: "Allergies",
  budget: "Budget",
};

export function TopicProgress({ covered }: { covered: InterviewTopic[] }) {
  const done = new Set(covered);
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={`Topics covered: ${covered.length} of ${INTERVIEW_TOPICS.length}`}>
      {INTERVIEW_TOPICS.map((t) => (
        <li
          key={t}
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            done.has(t) ? "bg-brand-soft text-brand" : "bg-page text-muted"
          }`}
        >
          {done.has(t) ? "✓ " : ""}
          {LABELS[t]}
        </li>
      ))}
    </ul>
  );
}
