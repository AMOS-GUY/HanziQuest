import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pager } from "@/components/admin/pager";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import { DEFAULT_PAGE_SIZE, pageCount, parsePage } from "@/lib/utilities/pagination";

export const metadata = { title: "Vocabulary" };

export default async function VocabularyPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const user = await requirePagePermission("curriculum:read");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const q = (sp.q ?? "").trim().slice(0, 40);
  const where = q
    ? {
        OR: [
          { simplified: { contains: q } },
          { pinyin: { contains: q, mode: "insensitive" as const } },
          { meaning: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};
  const [total, words] = await Promise.all([
    prisma.vocabulary.count({ where }),
    prisma.vocabulary.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
      include: { _count: { select: { lessons: true } } },
    }),
  ]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">Vocabulary</h1>
          <p className="text-muted-foreground text-sm">{total} words</p>
        </div>
        {user.permissions.has("curriculum:write") ? (
          <Button asChild>
            <Link href="/admin/vocabulary/new">New word</Link>
          </Button>
        ) : null}
      </div>
      <form className="mb-4 flex max-w-md gap-2" role="search">
        <label htmlFor="vocab-q" className="sr-only">
          Search words
        </label>
        <Input
          id="vocab-q"
          name="q"
          defaultValue={q}
          placeholder="Search characters, pinyin or meaning"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <div className="border-border bg-surface overflow-x-auto rounded-[var(--radius-card)] border-2">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-border text-muted-foreground border-b-2">
            <tr>
              <th className="px-4 py-2">Word</th>
              <th className="px-4 py-2">Pinyin</th>
              <th className="px-4 py-2">Meaning</th>
              <th className="px-4 py-2">Lessons</th>
              <th className="px-4 py-2">Verification</th>
            </tr>
          </thead>
          <tbody>
            {words.map((w) => (
              <tr key={w.id} className="border-border border-b last:border-0">
                <td className="px-4 py-2">
                  <Link
                    href={`/admin/vocabulary/${w.id}`}
                    lang="zh"
                    className="hanzi text-xl hover:underline"
                  >
                    {w.simplified}
                  </Link>
                </td>
                <td className="px-4 py-2">{w.pinyin}</td>
                <td className="px-4 py-2">{w.meaning}</td>
                <td className="px-4 py-2">{w._count.lessons}</td>
                <td className="px-4 py-2">
                  <Badge variant={w.verification === "VERIFIED" ? "default" : "warning"}>
                    {w.verification}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager
        page={page}
        pages={pageCount(total)}
        basePath="/admin/vocabulary"
        params={{ q: q || undefined }}
      />
    </div>
  );
}
