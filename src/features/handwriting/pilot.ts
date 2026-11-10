/**
 * Five-tester pilot plan (docs/HANDWRITING_PILOT.md). Each participant gets 36 prompts:
 * every pilot character written correctly twice (normal, then small or fast) plus one deliberate
 * error, with error types rotated per participant so that five participants cover every type
 * on every character.
 */
import type { SampleCategory } from "./validation";

/** Simple → complex, all in the HSK 1 starter set with stroke data. */
export const PILOT_CHARACTERS = [
  "人",
  "八",
  "上",
  "女",
  "中",
  "天",
  "他",
  "好",
  "你",
  "我",
  "是",
  "谢",
] as const;

/** A visually related character to write for WRONG_CHARACTER prompts. */
export const LOOKALIKE: Record<(typeof PILOT_CHARACTERS)[number], string> = {
  人: "八",
  八: "人",
  上: "下",
  女: "子",
  中: "十",
  天: "午",
  他: "她",
  好: "妈",
  你: "他",
  我: "没",
  是: "星",
  谢: "说",
};

const ERRORS: SampleCategory[] = [
  "WRONG_CHARACTER",
  "MISSING_STROKE",
  "EXTRA_STROKE",
  "WRONG_DIRECTION",
  "WRONG_ORDER",
  "POOR_SHAPE",
];

/** What the collector asks the participant to do, in plain words. */
export const INSTRUCTION: Record<SampleCategory, string> = {
  CORRECT: "Write it the way you normally would.",
  WRONG_CHARACTER: "Write the look-alike character instead.",
  MISSING_STROKE: "Write it but leave out one stroke (any one).",
  EXTRA_STROKE: "Write it and add one extra stroke anywhere.",
  WRONG_DIRECTION: "Write it but draw one long stroke backwards.",
  WRONG_ORDER: "Write it but swap the order of two strokes.",
  POOR_SHAPE: "Write it with one stroke clearly too long or in the wrong place.",
};

export interface PilotPrompt {
  key: string;
  hanzi: string;
  category: SampleCategory;
  style: string;
  writtenHanzi: string | null;
  instruction: string;
}

function offset(participantCode: string) {
  const digits = participantCode.replace(/\D/g, "");
  return digits ? Number.parseInt(digits, 10) % ERRORS.length : 0;
}

export function pilotPlan(participantCode: string): PilotPrompt[] {
  const shift = offset(participantCode);
  return PILOT_CHARACTERS.flatMap((hanzi, i) => {
    const error = ERRORS[(i + shift) % ERRORS.length]!;
    return [
      {
        key: `${hanzi}:CORRECT:normal`,
        hanzi,
        category: "CORRECT" as const,
        style: "normal",
        writtenHanzi: null,
        instruction: INSTRUCTION.CORRECT,
      },
      {
        key: `${hanzi}:CORRECT:small-or-fast`,
        hanzi,
        category: "CORRECT" as const,
        style: "small-or-fast",
        writtenHanzi: null,
        instruction: "Write it correctly, but small (about a third of the box) or quickly.",
      },
      {
        key: `${hanzi}:${error}:deliberate`,
        hanzi,
        category: error,
        style: "deliberate-error",
        writtenHanzi: error === "WRONG_CHARACTER" ? LOOKALIKE[hanzi] : null,
        instruction:
          error === "WRONG_CHARACTER"
            ? `Write ${LOOKALIKE[hanzi]} (a look-alike) instead.`
            : INSTRUCTION[error],
      },
    ];
  });
}

/** Key used to match recorded samples to plan prompts. */
export function sampleKey(s: { hanzi: string; category: string; style: string | null }) {
  return `${s.hanzi}:${s.category}:${s.style ?? "normal"}`;
}

/** Participant codes for automated tests; always excluded from human results. */
export const TEST_PARTICIPANT_PREFIX = "TEST";

export function isTestParticipant(code: string) {
  return code.toUpperCase().startsWith(TEST_PARTICIPANT_PREFIX);
}
