import Link from "next/link";

/** Footer with the beta's public documents. */
export function SiteFooter() {
  return (
    <footer className="border-border text-muted-foreground mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-t-2 pt-4 text-sm">
      <span>HanziQuest public beta</span>
      <nav aria-label="Legal and help" className="flex flex-wrap gap-x-5 gap-y-2">
        <Link href="/beta-guide" className="hover:text-foreground font-bold">
          Beta guide
        </Link>
        <Link href="/privacy" className="hover:text-foreground font-bold">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-foreground font-bold">
          Terms
        </Link>
      </nav>
    </footer>
  );
}

/** Shown on documents that have not been reviewed by a lawyer. */
export function DraftNotice() {
  return (
    <p
      role="note"
      className="mb-6 rounded-xl border-2 border-[#e9b949] bg-[#fff1d6] px-4 py-3 text-sm font-semibold text-[#5c3b00] dark:bg-[#3d2e10] dark:text-[#ffd58a]"
    >
      Draft for the beta, not yet reviewed by a lawyer. Items in [square brackets] are still to be
      filled in by the operator. If anything here is unclear, contact us before using HanziQuest.
    </p>
  );
}
