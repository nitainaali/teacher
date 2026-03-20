/**
 * Client-side FSRS interval prediction for button labels.
 * Must match backend constants in app/services/fsrs.py and flashcards.py.
 */
import type { Flashcard } from "../types";

// FSRS-4.5 constants (must match backend)
const DECAY = -0.5;
const FACTOR = 0.9 ** (1 / DECAY) - 1; // ≈ 19/81
const REQUEST_RETENTION = 0.9;

// Learning steps in minutes — must match backend LEARNING_STEPS_MINUTES
const LEARNING_STEPS_MINUTES = [1, 10];

// Must match backend INTERVAL_MULTIPLIER in srs.py
const INTERVAL_MULTIPLIER = 0.5;

// FSRS-4.5 default weights (must match backend W array)
const W = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0589,
  1.5330, 0.1544, 1.0070, 1.9395, 0.1100, 0.2900, 2.2700, 0.1450,
  2.9898, 0.5100, 0.0900,
];

export interface PredictedIntervals {
  again: string;
  hard: string;
  good: string;
  easy: string;
}

function calcReviewInterval(stability: number): number {
  if (stability <= 0) return 1;
  const raw = (stability / FACTOR) * (REQUEST_RETENTION ** (1 / DECAY) - 1);
  return Math.max(1, Math.round(raw * INTERVAL_MULTIPLIER));
}

function initialStability(grade: number): number {
  return Math.max(W[Math.max(1, Math.min(4, grade)) - 1], 0.1);
}

function stabilityAfterSuccess(s: number, d: number, r: number, grade: number): number {
  const hardPenalty = grade === 2 ? W[15] : 1.0;
  const easyBonus = grade === 4 ? W[16] : 1.0;
  return s * (
    Math.exp(W[8]) * (11 - d) *
    Math.pow(Math.max(s, 0.001), -W[9]) *
    (Math.exp((1 - r) * W[10]) - 1) *
    hardPenalty *
    easyBonus +
    1
  );
}

function stabilityAfterFailure(s: number, d: number, r: number): number {
  return (
    W[11] *
    Math.pow(Math.max(d, 0.001), -W[12]) *
    (Math.pow(Math.max(s + 1, 0.001), W[13]) - 1) *
    Math.exp((1 - r) * W[14])
  );
}

function forgettingCurve(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  return (1 + FACTOR * elapsedDays / stability) ** DECAY;
}

function estimateIntervalForGrade(card: Flashcard, grade: number): number {
  const s = card.stability || 0;
  const d = card.difficulty_fsrs || 5;
  const state = card.fsrs_state || "new";

  if (state === "review" || state === "relearning") {
    // Estimate elapsed days since last review (use 1 as fallback)
    let elapsed = 1;
    if (card.last_reviewed_at) {
      const delta = (Date.now() - new Date(card.last_reviewed_at).getTime()) / 86400000;
      elapsed = Math.max(1, Math.round(delta));
    }
    const r = forgettingCurve(elapsed, s);

    if (grade === 1) {
      // Again → failure
      const newS = Math.max(stabilityAfterFailure(s, d || 5, r), 0.1);
      return calcReviewInterval(newS);
    } else {
      const newS = Math.max(stabilityAfterSuccess(s, d || 5, r, grade), 0.1);
      return calcReviewInterval(newS);
    }
  }

  // new or learning: won't reach here for interval prediction
  return 1;
}

function formatMins(minutes: number): string {
  return `${minutes} min`;
}

function formatDays(days: number, t?: (key: string, opts?: Record<string, unknown>) => string): string {
  if (days === 1) return "1d";
  return `${days}d`;
}

/**
 * Predict what interval each rating button would produce for the given card.
 * Returns short display strings like "1m", "10m", "3d", "14d".
 */
export function predictIntervals(card: Flashcard): PredictedIntervals {
  const state = card.fsrs_state ?? "new";
  const step = card.learning_step; // null = new card (hasn't hit step 0 yet)

  if (state === "new" || state === "learning") {
    // Again → step 0 (1 min)
    const againStr = formatMins(LEARNING_STEPS_MINUTES[0]);
    // Hard → step 0 (1 min)
    const hardStr = formatMins(LEARNING_STEPS_MINUTES[0]);

    // Good → next step or graduate
    let goodStr: string;
    const nextStep = (step !== null && step !== undefined ? step : -1) + 1;
    if (nextStep < LEARNING_STEPS_MINUTES.length) {
      goodStr = formatMins(LEARNING_STEPS_MINUTES[nextStep]);
    } else {
      // Would graduate — estimate first review interval
      const gradS = card.stability > 0 ? card.stability : initialStability(3);
      goodStr = formatDays(calcReviewInterval(gradS));
    }

    // Easy → graduate immediately with fixed 1-day interval
    const easyStr = "1d";

    return { again: againStr, hard: hardStr, good: goodStr, easy: easyStr };
  }

  // review / relearning: calculate real FSRS intervals
  const againDays = estimateIntervalForGrade(card, 1);
  const hardDays = estimateIntervalForGrade(card, 2);
  const goodDays = estimateIntervalForGrade(card, 3);
  const easyDays = estimateIntervalForGrade(card, 4);

  return {
    again: formatDays(againDays),
    hard: formatDays(hardDays),
    good: formatDays(goodDays),
    easy: formatDays(easyDays),
  };
}
