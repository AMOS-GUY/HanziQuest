/**
 * XP rules. XP is always computed on the server from server-evaluated results; nothing a client
 * sends is used as an XP amount. See docs/DECISIONS.md D-021.
 */
import type { AttemptResult, PracticeMode } from "@/generated/prisma/enums";

export const XP = {
  attempt: { EXCELLENT: 10, GOOD: 8, NEEDS_IMPROVEMENT: 4, TRY_AGAIN: 1, SKIPPED: 0 },
  /** Guided (traced or hinted) practice earns half. */
  guidedMultiplier: 0.5,
  /** Only the first N attempts at the same exercise on the same day earn XP (anti-farming). */
  rewardedAttemptsPerExercisePerDay: 3,
  /** Ceiling on XP from exercise attempts per local day. Bonuses are not capped. */
  dailyAttemptCap: 300,
  /** Ceiling for a recall written with a stroke order/direction fault (D-033). */
  techniqueFault: 5,
  lessonCompleted: 20,
  dailyGoalBonus: 10,
} as const satisfies {
  attempt: Record<AttemptResult, number>;
  [key: string]: unknown;
};

export function attemptXp(input: {
  result: AttemptResult;
  mode: PracticeMode;
  /** At least one character was recalled with a stroke order/direction fault. */
  techniqueFault?: boolean;
  /** Earlier attempts at this exercise today that already earned XP. */
  rewardedToday: number;
  /** XP already earned from attempts today. */
  attemptXpToday: number;
}): number {
  if (input.rewardedToday >= XP.rewardedAttemptsPerExercisePerDay) return 0;
  let amount: number = XP.attempt[input.result];
  if (input.techniqueFault) amount = Math.min(amount, XP.techniqueFault);
  if (input.mode === "GUIDED") amount = Math.ceil(amount * XP.guidedMultiplier);
  const room = Math.max(0, XP.dailyAttemptCap - input.attemptXpToday);
  return Math.min(amount, room);
}
