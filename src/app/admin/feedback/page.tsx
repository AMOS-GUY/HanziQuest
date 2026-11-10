import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { AdminForm } from "@/components/admin/admin-form";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import { setFeedbackStatusAction } from "@/features/feedback/actions";
import { FEEDBACK_LABEL } from "@/features/feedback/feedback";
import { cn } from "@/lib/utilities/cn";

export const metadata = { title: "Feedback" };

const STATUSES = ["NEW", "TRIAGED", "RESOLVED", "CLOSED"] as const;

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const viewer = await requirePagePermission("feedback:manage");
  const raw = (await searchParams).status;
  const status = STATUSES.includes(raw as never) ? (raw as (typeof STATUSES)[number]) : "NEW";
  const [items, counts] = await Promise.all([
    prisma.feedback.findMany({
      where: { status },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { id: true, email: true } } },
    }),
    prisma.feedback.groupBy({ by: ["status"], _count: true }),
  ]);
  const count = new Map(counts.map((c) => [c.status, c._count]));
  const canSeeUsers = viewer.permissions.has("users:read");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-3xl font-black">Feedback</h1>
        <p className="text-muted-foreground text-sm">
          Beta feedback and bug reports. Triage process: <code>docs/BUG_REPORTING.md</code>. The
          reporter&apos;s email is shown only if they agreed to be contacted.
        </p>
      </div>
      <nav aria-label="Status" className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/feedback?status=${s}`}
            aria-current={s === status ? "page" : undefined}
            className={cn(
              "border-border rounded-full border-2 px-3 py-1 text-sm font-bold",
              s === status && "border-primary bg-accent",
            )}
          >
            {s.toLowerCase()} · {count.get(s) ?? 0}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <p className="text-muted-foreground">Nothing here.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((f) => (
            <li key={f.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={f.kind === "BUG" ? "danger" : "default"}>
                    {FEEDBACK_LABEL[f.kind]}
                  </Badge>
                  <span className="text-muted-foreground">
                    {f.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                    {f.pagePath ? ` · ${f.pagePath}` : ""}
                    {f.userAgent ? ` · ${f.userAgent}` : ""}
                    {f.appRelease ? ` · release ${f.appRelease}` : ""}
                  </span>
                </div>
                <p className="whitespace-pre-wrap">{f.message}</p>
                {f.allowContact && f.user ? (
                  <p className="text-sm">
                    Contact:{" "}
                    {canSeeUsers ? (
                      <Link
                        href={`/admin/users/${f.user.id}`}
                        className="text-primary font-bold underline"
                      >
                        {f.user.email}
                      </Link>
                    ) : (
                      f.user.email
                    )}
                  </p>
                ) : null}
                {f.staffNote ? (
                  <p className="text-muted-foreground text-sm">Note: {f.staffNote}</p>
                ) : null}
                <details>
                  <summary className="text-primary cursor-pointer text-sm font-bold">
                    Update status
                  </summary>
                  <AdminForm
                    className="mt-3"
                    action={setFeedbackStatusAction.bind(null, f.id)}
                    submitLabel="Update"
                    fields={[
                      {
                        name: "status",
                        label: "Status",
                        type: "select",
                        defaultValue: f.status,
                        options: STATUSES.map((s) => ({ value: s, label: s.toLowerCase() })),
                      },
                      { name: "staffNote", label: "Note (internal)", defaultValue: f.staffNote },
                    ]}
                  />
                </details>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
