/**
 * The five booth questions, in order. The team approved these on 2026-06-01
 * (see project memory). Each question is designed to elicit a specific
 * signal in the analysis pipeline:
 *   Q1 → future_vision, certainty                (what they want)
 *   Q2 → limiting_beliefs ("doesn't believe yet") (the gap)
 *   Q3 → ownership, commitment                    (where it has to land)
 *   Q4 → sentiment, regret, cost-of-inaction      (what staying costs)
 *   Q5 → limiting_beliefs (explicit)              (what they'd shed)
 *
 * Local-dev override:
 *   Set `NEXT_PUBLIC_BOOTH_QUESTION_COUNT=1` (or 2, 3, etc.) in `.env.local`
 *   to truncate the question list during local testing — useful for
 *   iterating without sitting through the full 4–5 min flow each cycle.
 *   The var is `NEXT_PUBLIC_` so it's inlined at build time; production
 *   deployments that don't set it ship the full five questions.
 */
export type BoothQuestion = {
  /** 1-indexed for display ("Question 3 of 5") */
  index: number;
  /** Short headline for screen transitions + stage headers */
  label: string;
  /** Full question text, rendered on the recording screen */
  text: string;
};

const ALL_QUESTIONS: BoothQuestion[] = [
  {
    index: 1,
    label: "Celebrating",
    text: "What are you going to be celebrating a year from today?",
  },
  {
    index: 2,
    label: "If she walked in",
    text:
      "If that version of you walked into a room right now — how would you know it was her? What does she believe about herself that you don't quite believe yet?",
  },
  {
    index: 3,
    label: "Where she shows up",
    text:
      "Where is the one place you most need your future self to show up? In your business. In a conversation. In the ask you haven't made yet.",
  },
  {
    index: 4,
    label: "The cost",
    text: "What has staying where you are actually cost you?",
  },
  {
    index: 5,
    label: "What you'd shed",
    text:
      "What would you have to stop believing about yourself for the next version to be possible?",
  },
];

function activeQuestionCount(): number {
  const raw = process.env.NEXT_PUBLIC_BOOTH_QUESTION_COUNT;
  if (!raw) return ALL_QUESTIONS.length;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return ALL_QUESTIONS.length;
  return Math.min(parsed, ALL_QUESTIONS.length);
}

export const QUESTIONS: BoothQuestion[] = ALL_QUESTIONS.slice(
  0,
  activeQuestionCount()
);

export const TOTAL_QUESTIONS = QUESTIONS.length;

/** Kept for back-compat with the cron + email path. The "prompt" stored on
 *  each session row is now the JSON-stringified question list — see analyze
 *  route. */
export const PRIMARY_PROMPT =
  "What are you going to be celebrating a year from today?";
