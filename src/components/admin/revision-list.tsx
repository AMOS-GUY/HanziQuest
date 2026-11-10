import Link from "next/link";
import { prisma } from "@/lib/database/prisma";

/** Recent content revisions (snapshots taken before each edit) for one record. */
export async function RevisionList({
  entityType,
  entityId,
}: {
  entityType: string | string[];
  entityId: string;
}) {
  const revisions = await prisma.contentRevision.findMany({
    where: {
      entityId,
      entityType: { in: Array.isArray(entityType) ? entityType : [entityType] },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { author: { select: { email: true } } },
  });
  return (
    <section aria-labelledby={`rev-${entityId}`}>
      <h2 id={`rev-${entityId}`} className="mb-2 text-lg font-extrabold">
        Revision history
      </h2>
      {revisions.length === 0 ? (
        <p className="text-muted-foreground text-sm">No edits yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {revisions.map((r) => (
            <li key={r.id} className="border-border rounded-xl border-2 p-3 text-sm">
              <details>
                <summary className="cursor-pointer font-bold">
                  {r.entityType} revision {r.revision} ·{" "}
                  {r.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                  {r.author ? ` · ${r.author.email}` : ""}
                </summary>
                <pre className="bg-surface-muted mt-2 max-h-60 overflow-auto rounded-lg p-2 text-xs">
                  {JSON.stringify(r.data, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AdminBack({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-primary mb-3 inline-block text-sm font-bold">
      ← {label}
    </Link>
  );
}
