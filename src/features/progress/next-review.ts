/**
 * Wording for when the next review is due (M15-d), in the learner's own time zone: "today at
 * 18:30", "tomorrow at 09:00", "on Friday at 14:30", or "on 27 Nov" further ahead. Pure, so the
 * home page needs no new data: it formats the schedule the app already keeps.
 */
import { addDays, localDay } from "./calendar";

export function nextReviewText(dueAt: Date, now: Date, timezone: string): string {
  let zone = timezone;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zone,
  }).format(dueAt);
  const today = localDay(now, zone);
  const day = localDay(dueAt, zone);
  if (day <= today) return `today at ${time}`;
  if (day === addDays(today, 1)) return `tomorrow at ${time}`;
  if (day <= addDays(today, 6))
    return `on ${new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: zone }).format(dueAt)} at ${time}`;
  return `on ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: zone }).format(dueAt)}`;
}
