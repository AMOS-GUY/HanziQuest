import type { ExerciseType } from "@/generated/prisma/enums";
import type { ReferenceCharacter } from "@/features/handwriting/types";
import type { CharacterStrokeJson } from "@/features/handwriting/reference-store";

/** Exercise shape sent to the practice runner. */
export interface ExerciseDTO {
  id: string;
  type: ExerciseType;
  prompt: { hanzi?: string; pinyin?: string; meaning?: string };
  /** Characters the learner must write, in order. */
  characters: string[];
  hint: string | null;
}

/** Everything the practice runner needs to evaluate locally and render references. */
export interface PracticePayload {
  exercises: ExerciseDTO[];
  /** Raw stroke data for characters in these exercises (Hanzi Writer format). */
  strokeData: Record<string, CharacterStrokeJson>;
  /** Candidate set for local identity verification (same set the server uses). */
  candidates: ReferenceCharacter[];
}
