import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pager({
  page,
  pages,
  basePath,
  params = {},
}: {
  page: number;
  pages: number;
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  if (pages <= 1) return null;
  const href = (p: number) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
    search.set("page", String(p));
    return `${basePath}?${search.toString()}`;
  };
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
      {page > 1 ? (
        <Link href={href(page - 1)} className="text-primary flex items-center gap-1 font-bold">
          <ChevronLeft className="size-4" aria-hidden /> Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className="text-primary flex items-center gap-1 font-bold">
          Next <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
