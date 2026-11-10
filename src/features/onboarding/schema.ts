import { z } from "zod";

export const EXPERIENCE_OPTIONS = [
  { value: "NEW", label: "I'm completely new to Chinese" },
  { value: "BEGINNER", label: "I know some basics" },
  { value: "INTERMEDIATE", label: "I can read everyday text with help" },
  { value: "ADVANCED", label: "I'm comfortable reading Chinese" },
] as const;

export const OBJECTIVE_OPTIONS = [
  { value: "hsk_exam", label: "Pass an HSK exam" },
  { value: "write_by_hand", label: "Write characters by hand" },
  { value: "read", label: "Read Chinese" },
  { value: "travel", label: "Travel" },
  { value: "work_study", label: "Work or study" },
  { value: "personal", label: "Personal interest" },
] as const;

export const DAILY_GOAL_OPTIONS = [
  { value: 10, label: "Casual", detail: "about 5 min a day" },
  { value: 20, label: "Regular", detail: "about 10 min a day" },
  { value: 30, label: "Serious", detail: "about 15 min a day" },
  { value: 50, label: "Intense", detail: "about 25 min a day" },
] as const;

function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const onboardingSchema = z.object({
  experienceLevel: z.enum(["NEW", "BEGINNER", "INTERMEDIATE", "ADVANCED"]),
  /** 0 = no HSK level. Self-reported only — never treated as mastery. */
  declaredHskLevel: z.number().int().min(0).max(6),
  declaredLessonNote: z.string().trim().max(120).optional(),
  learningObjectives: z
    .array(z.enum(["hsk_exam", "write_by_hand", "read", "travel", "work_study", "personal"]))
    .max(6),
  dailyGoalXp: z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(50)]),
  timezone: z.string().max(64).refine(isValidTimeZone, "Unknown time zone"),
  takePlacement: z.boolean(),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
