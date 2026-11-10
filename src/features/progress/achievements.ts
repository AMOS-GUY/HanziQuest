/** Achievement definitions, seeded into the Achievement table. Criteria are evaluated in record.ts. */
export const ACHIEVEMENTS: {
  key: string;
  name: string;
  description: string;
  icon: string;
  criteria: { type: string; count?: number; days?: number };
  xpReward: number;
}[] = [
  {
    key: "first-character",
    name: "First stroke",
    description: "Write your first character correctly.",
    icon: "pen-line",
    criteria: { type: "characters_written", count: 1 },
    xpReward: 10,
  },
  {
    key: "first-lesson",
    name: "Lesson one",
    description: "Complete your first lesson.",
    icon: "book-open-check",
    criteria: { type: "lessons_completed", count: 1 },
    xpReward: 20,
  },
  {
    key: "ten-characters",
    name: "Ten characters",
    description: "Learn ten different characters.",
    icon: "sparkles",
    criteria: { type: "characters_learned", count: 10 },
    xpReward: 30,
  },
  {
    key: "streak-3",
    name: "Three-day streak",
    description: "Practise three days in a row.",
    icon: "flame",
    criteria: { type: "streak", days: 3 },
    xpReward: 20,
  },
  {
    key: "streak-7",
    name: "One-week streak",
    description: "Practise seven days in a row.",
    icon: "flame",
    criteria: { type: "streak", days: 7 },
    xpReward: 50,
  },
];
