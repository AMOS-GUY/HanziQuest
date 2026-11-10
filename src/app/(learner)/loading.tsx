/** Shown while a page's server data loads. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4 py-2">
      <div className="bg-surface-muted h-9 w-56 animate-pulse rounded-xl motion-reduce:animate-none" />
      <div className="bg-surface-muted h-32 w-full animate-pulse rounded-[var(--radius-card)] motion-reduce:animate-none" />
      <div className="bg-surface-muted h-24 w-full animate-pulse rounded-[var(--radius-card)] motion-reduce:animate-none" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
