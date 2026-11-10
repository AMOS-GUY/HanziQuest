export const DEFAULT_PAGE_SIZE = 25;

/** Parses a 1-based page number from a search param, clamped to a sane range. */
export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(raw ?? "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 10_000);
}

export function pageCount(total: number, pageSize = DEFAULT_PAGE_SIZE) {
  return Math.max(1, Math.ceil(total / pageSize));
}
