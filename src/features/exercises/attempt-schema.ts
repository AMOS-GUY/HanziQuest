import { z } from "zod";

const coordinate = z.number().finite().min(-0.25).max(1.25);

export const inkStrokeSchema = z.object({
  points: z
    .array(z.object({ x: coordinate, y: coordinate, t: z.number().finite().min(0).max(3_600_000) }))
    .min(1)
    .max(600),
});

/** One drawing per expected character. */
export const drawingsSchema = z.array(z.array(inkStrokeSchema).max(40)).min(1).max(6);

const base = {
  clientEventId: z.uuid(),
  exerciseId: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(64).optional(),
  occurredAt: z.iso.datetime({ offset: true }),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
  hintsUsed: z.number().int().min(0).max(20).default(0),
};

export const attemptInputSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("writing"), drawings: drawingsSchema }),
  z.object({
    ...base,
    kind: z.literal("guided"),
    /** Mistakes reported by the Hanzi Writer quiz (client-reported, low trust). */
    mistakes: z.number().int().min(0).max(500),
  }),
  z.object({ ...base, kind: z.literal("skip") }),
]);

export type AttemptInput = z.infer<typeof attemptInputSchema>;
