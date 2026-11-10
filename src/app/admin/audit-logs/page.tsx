import { Pager } from "@/components/admin/pager";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import { DEFAULT_PAGE_SIZE, pageCount, parsePage } from "@/lib/utilities/pagination";

export const metadata = { title: "Audit log" };

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requirePagePermission("audit:read");
  const page = parsePage((await searchParams).page);
  const [total, entries] = await Promise.all([
    prisma.auditLog.count(),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
      include: { actor: { select: { email: true } } },
    }),
  ]);

  return (
    <div>
      <h1 className="mb-6 text-3xl font-black">Audit log</h1>
      {entries.length === 0 ? (
        <p className="text-muted-foreground">No audit entries yet.</p>
      ) : (
        <div className="border-border bg-surface overflow-x-auto rounded-[var(--radius-card)] border-2">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-border text-muted-foreground border-b-2">
              <tr>
                <th className="px-4 py-2">Time (UTC)</th>
                <th className="px-4 py-2">Actor</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Entity</th>
                <th className="px-4 py-2">Change</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-border border-b align-top last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap">
                    {e.createdAt.toISOString().slice(0, 19).replace("T", " ")}
                  </td>
                  <td className="px-4 py-2">{e.actor?.email ?? "system"}</td>
                  <td className="px-4 py-2 font-mono text-xs">{e.action}</td>
                  <td className="px-4 py-2 text-xs">
                    {e.entityType}
                    {e.entityId ? (
                      <span className="text-muted-foreground block">{e.entityId}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs break-all">
                    {e.before ? (
                      <span className="text-muted-foreground block">
                        − {JSON.stringify(e.before)}
                      </span>
                    ) : null}
                    {e.after ? <span className="block">+ {JSON.stringify(e.after)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} pages={pageCount(total)} basePath="/admin/audit-logs" />
    </div>
  );
}
