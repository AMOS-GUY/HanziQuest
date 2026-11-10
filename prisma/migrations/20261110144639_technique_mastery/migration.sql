-- AlterTable
ALTER TABLE "AttemptCharacterResult" ADD COLUMN     "techniqueOk" BOOLEAN;

-- AlterTable
ALTER TABLE "CharacterMastery" ADD COLUMN     "consecutiveCleanTechnique" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastTechniqueOk" BOOLEAN,
ADD COLUMN     "techniqueAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "techniqueClean" INTEGER NOT NULL DEFAULT 0;

-- Backfill: judge technique on past independent recalls from the stored engine output
-- (order/direction feedback codes). Run `npm run progress:rebuild` afterwards to recompute mastery.
UPDATE "AttemptCharacterResult" acr
SET "techniqueOk" = NOT EXISTS (
  SELECT 1
  FROM jsonb_array_elements(COALESCE(ea."evaluation"->'characters'->acr."position"->'feedback', '[]'::jsonb)) f
  WHERE f->>'code' IN ('STROKE_ORDER', 'STROKE_DIRECTION')
)
FROM "ExerciseAttempt" ea
WHERE ea."id" = acr."attemptId"
  AND acr."mode" = 'INDEPENDENT'
  AND acr."result" IN ('EXCELLENT', 'GOOD')
  AND jsonb_typeof(ea."evaluation"->'characters') = 'array';
