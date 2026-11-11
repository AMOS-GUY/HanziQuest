import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import { operationsStatus } from "@/features/operations/status";

export const metadata = { title: "Operations" };
export const dynamic = "force-dynamic";

function age(iso: string | null, now: Date) {
  if (!iso) return "–";
  const hours = Math.round((now.getTime() - new Date(iso).getTime()) / 3_600_000);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

function Stat({
  label,
  value,
  alert,
  children,
}: {
  label: string;
  value: React.ReactNode;
  alert?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <p className="text-muted-foreground text-sm font-semibold">{label}</p>
      <p className="flex items-center gap-2 text-2xl font-black">
        {value}
        {alert ? <Badge variant="warning">Check</Badge> : null}
      </p>
      {children ? <div className="text-muted-foreground mt-1 text-sm">{children}</div> : null}
    </Card>
  );
}

export default async function OperationsPage() {
  await requirePagePermission("analytics:read");
  const s = await operationsStatus(prisma);
  const now = new Date(s.generatedAt);
  const fatal = s.configuration.filter((i) => i.fatal);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="mb-1 text-3xl font-black">Operations</h1>
        <p className="text-muted-foreground text-sm">
          Release <code>{s.release}</code> · generated{" "}
          {s.generatedAt.slice(0, 16).replace("T", " ")} UTC. Uptime monitors should poll{" "}
          <code>/api/health</code>.
        </p>
      </div>

      <section aria-labelledby="ops-system" className="flex flex-col gap-3">
        <h2 id="ops-system" className="text-xl font-extrabold">
          System
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Database round trip"
            value={`${s.database.latencyMs} ms`}
            alert={s.database.latencyMs > 250}
          />
          <Stat
            label="Migrations applied"
            value={s.migrations.applied}
            alert={s.migrations.incomplete > 0}
          >
            {s.migrations.incomplete > 0
              ? `${s.migrations.incomplete} unfinished or failed: see DEPLOYMENT.md before serving traffic.`
              : `Latest: ${s.migrations.latest ?? "–"}`}
          </Stat>
          <Stat
            label="Configuration warnings"
            value={s.configuration.length}
            alert={s.configuration.length > 0}
          >
            {fatal.length > 0 ? `${fatal.length} would stop a production start.` : null}
          </Stat>
        </div>
        {s.configuration.length > 0 ? (
          <Card>
            <CardTitle className="mb-2 text-base">Configuration</CardTitle>
            <ul className="flex flex-col gap-1 text-sm">
              {s.configuration.map((i) => (
                <li key={i.name}>
                  <code className="font-bold">{i.name}</code> {i.problem}
                  {i.fatal ? (
                    <Badge variant="danger" className="ml-2">
                      fatal in production
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </section>

      <section aria-labelledby="ops-beta" className="flex flex-col gap-3">
        <h2 id="ops-beta" className="text-xl font-extrabold">
          Beta
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Registration"
            value={s.registration.mode === "invite" ? "Invite-only" : "Open"}
            alert={s.registration.mode === "open"}
          >
            {s.registration.activeInvites} active invites ·{" "}
            <Link href="/admin/invites" className="underline">
              manage
            </Link>
          </Stat>
          <Stat label="Learners" value={s.learners.total}>
            {s.learners.activeLast7Days} active in the last 7 days ·{" "}
            {s.registration.signupsLast7Days} new
          </Stat>
          <Stat
            label="New feedback"
            value={s.feedback.new}
            alert={s.feedback.new > 0 && age(s.feedback.oldestNewAt, now).includes("days")}
          >
            Oldest untriaged: {age(s.feedback.oldestNewAt, now)} ·{" "}
            <Link href="/admin/feedback" className="underline">
              triage
            </Link>
          </Stat>
        </div>
      </section>

      <section aria-labelledby="ops-sync" className="flex flex-col gap-3">
        <h2 id="ops-sync" className="text-xl font-extrabold">
          Offline sync
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label="Stuck uploads (over 15 min)" value={s.sync.stuck} alert={s.sync.stuck > 0}>
            Events received but never processed: an unexpected error. Check the error reports.
          </Stat>
          <Stat
            label="Rejected in the last 24 h"
            value={s.sync.rejectedLast24h}
            alert={s.sync.rejectedLast24h > 20}
          >
            Rejections are expected occasionally (e.g. a lesson unpublished while offline).
          </Stat>
        </div>
        {s.sync.topRejections.length > 0 ? (
          <Card>
            <CardTitle className="mb-2 text-base">Most common rejections (7 days)</CardTitle>
            <ul className="flex flex-col gap-1 text-sm">
              {s.sync.topRejections.map((r) => (
                <li key={r.error}>
                  <strong>{r.count}×</strong> {r.error}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </section>

      <section aria-labelledby="ops-data" className="flex flex-col gap-3">
        <h2 id="ops-data" className="text-xl font-extrabold">
          Data
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label="Handwriting pilot samples" value={s.handwritingPilot.samples}>
            From {s.handwritingPilot.participants} participants (test samples excluded)
          </Stat>
          <Stat label="Audit log entries" value={s.auditLog.entries}>
            Oldest: {age(s.auditLog.oldestAt, now)}. Retention: <code>npm run ops:prune</code>{" "}
            (owner decides the period).
          </Stat>
        </div>
      </section>
    </div>
  );
}
