/** Shown while exercises and stroke data load: the same shape as the practice screen. */
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Preparing your exercises"
      className="mx-auto flex w-full max-w-md flex-col gap-4 py-2"
    >
      <div className="bg-surface-muted h-3 w-full animate-pulse rounded-full motion-reduce:animate-none" />
      <div className="bg-surface-muted mx-auto h-8 w-48 animate-pulse rounded-xl motion-reduce:animate-none" />
      <div className="bg-surface-muted aspect-square w-full animate-pulse rounded-3xl motion-reduce:animate-none" />
      <p className="text-muted-foreground text-center text-sm">Preparing your exercises…</p>
    </div>
  );
}
