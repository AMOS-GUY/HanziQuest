import { Badge } from "@/components/ui/badge";
import { Pager } from "@/components/admin/pager";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import { DEFAULT_PAGE_SIZE, pageCount, parsePage } from "@/lib/utilities/pagination";

export const metadata = { title: "Characters" };

export default async function AdminCharactersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requirePagePermission("curriculum:read");
  const page = parsePage((await searchParams).page);
  const [total, characters] = await Promise.all([
    prisma.character.count(),
    prisma.character.findMany({
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
      include: { _count: { select: { vocabulary: true } } },
    }),
  ]);

  return (
    <div>
      <h1 className="mb-1 text-3xl font-black">Characters</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        {total} characters. Editing arrives in a later milestone.
      </p>
      <div className="border-border bg-surface overflow-x-auto rounded-[var(--radius-card)] border-2">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-border text-muted-foreground border-b-2">
            <tr>
              <th className="px-4 py-2">Character</th>
              <th className="px-4 py-2">Pinyin</th>
              <th className="px-4 py-2">Meaning</th>
              <th className="px-4 py-2">Strokes</th>
              <th className="px-4 py-2">Words</th>
              <th className="px-4 py-2">Verification</th>
            </tr>
          </thead>
          <tbody>
            {characters.map((c) => (
              <tr key={c.id} className="border-border border-b last:border-0">
                <td lang="zh" className="hanzi px-4 py-2 text-2xl">
                  {c.hanzi}
                </td>
                <td className="px-4 py-2">{c.pinyin}</td>
                <td className="px-4 py-2">{c.meaning}</td>
                <td className="px-4 py-2">
                  {c.strokeCount ?? <Badge variant="danger">missing</Badge>}
                </td>
                <td className="px-4 py-2">{c._count.vocabulary}</td>
                <td className="px-4 py-2">
                  <Badge variant={c.verification === "VERIFIED" ? "default" : "warning"}>
                    {c.verification}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={pageCount(total)} basePath="/admin/characters" />
    </div>
  );
}
