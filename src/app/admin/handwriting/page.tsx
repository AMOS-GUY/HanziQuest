import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import Link from "next/link";
import { analyseSamples, participantSummary, pilotProgress } from "@/features/handwriting/samples";
import { ENGINE_VERSION } from "@/features/handwriting/evaluate";
import { CATEGORY_LABEL, formatRate } from "@/features/handwriting/validation";
import { participantOverview } from "@/features/handwriting/participants";
import { currentConsentForm } from "@/features/handwriting/consent";
import { eraseParticipantAction, recordConsentAction } from "@/features/handwriting/lab-actions";
import { hasPermission } from "@/lib/permissions/permissions";
import { AdminForm } from "@/components/admin/admin-form";
import { SampleRecorder } from "./sample-recorder";

const STATUS_LABEL = {
  ACTIVE: "Active",
  WITHDRAWN: "Withdrawn (data erased)",
  RETENTION_ENDED: "Retention ended (data erased)",
} as const;

export const metadata = { title: "Handwriting lab" };
export const dynamic = "force-dynamic";

const PILOT_CODES = ["P01", "P02", "P03", "P04", "P05"];

export default async function HandwritingLabPage({
  searchParams,
}: {
  searchParams: Promise<{ participant?: string }>;
}) {
  const user = await requirePagePermission("handwriting:validate");
  const canErase = hasPermission(user.roles, "handwriting:erase");
  const form = currentConsentForm();
  const raw = (await searchParams).participant ?? "";
  const participant = /^[A-Za-z0-9-]{1,16}$/.test(raw) ? raw.toUpperCase() : "";
  const [characters, { metrics }, people, pilot, participants] = await Promise.all([
    prisma.character.findMany({
      where: { hasStrokeData: true, lessons: { some: {} } },
      orderBy: { createdAt: "asc" },
      select: { hanzi: true },
    }),
    analyseSamples(prisma),
    participantSummary(prisma),
    participant ? pilotProgress(prisma, participant) : Promise.resolve(null),
    participantOverview(prisma),
  ]);
  const selected = participants.find((p) => p.code === participant) ?? null;
  const counts = new Map(people.map((p) => [p.code, p.samples]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-black">Handwriting lab</h1>
        <p className="text-muted-foreground text-sm">
          Collect real, labelled handwriting from consenting testers and measure how often the
          engine ({ENGINE_VERSION}) wrongly accepts or rejects it. Follow the procedure in{" "}
          <code>docs/HANDWRITING_VALIDATION.md</code>. Thresholds change only on this evidence.
        </p>
      </div>

      <Card>
        <CardTitle className="mb-3">Results so far ({metrics.total} samples)</CardTitle>
        {metrics.warnings.length ? (
          <Alert className="mb-3">
            <ul className="list-disc pl-5">
              {metrics.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <dl className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(
            [
              ["False rejection (correct, failed)", metrics.falseRejection],
              [
                "Structural false acceptance (wrong / missing / extra)",
                metrics.structuralFalseAcceptance,
              ],
              [
                "Technique errors accepted (direction / order / shape)",
                metrics.techniqueAcceptance,
              ],
              ["Specific error named", metrics.errorNamed],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="bg-surface-muted rounded-xl p-3">
              <dt className="text-muted-foreground text-sm">{label}</dt>
              <dd className="text-xl font-black">{formatRate(value)}</dd>
            </div>
          ))}
        </dl>
        <div
          role="region"
          aria-label="Handwriting samples (scrolls sideways)"
          tabIndex={0}
          className="overflow-x-auto"
        >
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-muted-foreground border-border border-b-2">
              <tr>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3">Samples</th>
                <th className="py-2 pr-3">Accepted</th>
                <th className="py-2">Error named</th>
              </tr>
            </thead>
            <tbody>
              {metrics.byCategory.map((c) => (
                <tr key={c.category} className="border-border border-b last:border-0">
                  <td className="py-2 pr-3">{CATEGORY_LABEL[c.category]}</td>
                  <td className="py-2 pr-3">{c.total}</td>
                  <td className="py-2 pr-3">{formatRate(c.accepted)}</td>
                  <td className="py-2">
                    {c.category === "CORRECT" ? "—" : formatRate(c.detected)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(["inputDevice", "sizeBucket"] as const).map((k) =>
          metrics.breakdowns[k].length ? (
            <p key={k} className="text-muted-foreground mt-3 text-sm">
              By {k === "inputDevice" ? "input" : "writing size"}:{" "}
              {metrics.breakdowns[k]
                .map((b) => `${b.key}: FAR ${formatRate(b.far)}, FRR ${formatRate(b.frr)}`)
                .join(" · ")}
            </p>
          ) : null,
        )}
        <CardDescription className="mt-3">
          Export for analysis:{" "}
          <a className="text-primary font-bold underline" href="/api/admin/handwriting/samples">
            results (JSON)
          </a>{" "}
          or{" "}
          <a
            className="text-primary font-bold underline"
            href="/api/admin/handwriting/samples?strokes=1"
          >
            with raw strokes
          </a>
          .
        </CardDescription>
      </Card>

      <Card>
        <CardTitle className="mb-1">Pilot: five testers</CardTitle>
        <CardDescription className="mb-3">
          Follow <code>docs/HANDWRITING_PILOT.md</code>. Pick the tester, then record the 36 prompts
          in order. Each prompt fills in the character and what to ask for.
        </CardDescription>
        <ul className="flex flex-wrap gap-2">
          {PILOT_CODES.map((code) => (
            <li key={code}>
              <Link
                href={`/admin/handwriting?participant=${code}`}
                aria-current={participant === code ? "true" : undefined}
                className="border-border aria-[current=true]:border-primary aria-[current=true]:bg-accent rounded-full border-2 px-3 py-1 text-sm font-bold"
              >
                {code} · {counts.get(code) ?? 0}/36
              </Link>
            </li>
          ))}
        </ul>
        {pilot ? (
          <p className="mt-3 text-sm font-bold" role="status">
            {participant}: {pilot.recorded} of {pilot.plan.length} pilot prompts recorded.
            {pilot.next ? "" : " Session complete. Thank the tester!"}
          </p>
        ) : null}
      </Card>

      <Card>
        <CardTitle className="mb-1">Participants and consent</CardTitle>
        <CardDescription className="mb-3">
          Record consent only with the signed paper form in front of you (protocol section 4). Codes
          only: never a name, initials or contact detail. Current form:{" "}
          <strong>{form.version}</strong>
          {form.ownerApproved
            ? "."
            : " (draft awaiting owner approval: only TEST rehearsal codes can be used)."}
        </CardDescription>
        {participants.length ? (
          <div
            role="region"
            aria-label="Participants (scrolls sideways)"
            tabIndex={0}
            className="mb-4 overflow-x-auto"
          >
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-muted-foreground border-border border-b-2">
                <tr>
                  <th className="py-2 pr-3">Code</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Consent ({form.version})</th>
                  <th className="py-2 pr-3">Samples</th>
                  <th className="py-2">Can record</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p) => (
                  <tr key={p.code} className="border-border border-b last:border-0">
                    <td className="py-2 pr-3 font-bold">{p.code}</td>
                    <td className="py-2 pr-3">{STATUS_LABEL[p.status]}</td>
                    <td className="py-2 pr-3">
                      {p.currentConsentAt ? p.currentConsentAt.toISOString().slice(0, 10) : "—"}
                    </td>
                    <td className="py-2 pr-3">{p.samples}</td>
                    <td className="py-2">{p.canRecord ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <AdminForm
          action={recordConsentAction}
          submitLabel="Record consent"
          resetOnSuccess
          fields={[
            {
              name: "participantCode",
              label: "Code giving consent",
              defaultValue: participant,
              help: "P01–P05 for the pilot, TEST… for rehearsals.",
              required: true,
            },
            { name: "version", type: "hidden", label: "Version", defaultValue: form.version },
            {
              name: "acceptedAt",
              label: "Date signed (YYYY-MM-DD)",
              help: "As written on the paper form.",
              required: true,
            },
            {
              name: "witnessed",
              label: "Signed form",
              type: "select",
              required: true,
              options: [
                { value: "", label: "Choose…" },
                { value: "yes", label: "I have the signed paper form in front of me" },
              ],
            },
          ]}
        />
        {canErase ? (
          <div className="border-border mt-6 border-t-2 pt-4">
            <h2 className="text-danger mb-1 font-black">Withdraw or end retention (erase)</h2>
            <p className="text-muted-foreground mb-3 text-sm">
              Permanently deletes every sample for the code, redacts their audit entries, revokes
              consent and blocks the code from further collection. This can&apos;t be undone.
              Exported files on other machines must be deleted by hand (protocol section 8).
            </p>
            <AdminForm
              action={eraseParticipantAction}
              submitLabel="Erase permanently"
              resetOnSuccess
              fields={[
                { name: "participantCode", label: "Code to erase", required: true },
                {
                  name: "reason",
                  label: "Reason",
                  type: "select",
                  required: true,
                  options: [
                    { value: "WITHDRAWAL", label: "Participant withdrew" },
                    { value: "RETENTION_ENDED", label: "Retention period ended" },
                  ],
                },
                { name: "confirmCode", label: "Type the code again to confirm", required: true },
              ]}
            />
          </div>
        ) : null}
      </Card>

      <Card>
        <CardTitle className="mb-4">Record a sample</CardTitle>
        {participant && !selected?.canRecord ? (
          <Alert className="mb-3">
            {participant} can&apos;t record samples yet: record their signed consent above. (A
            withdrawn code can never record again.)
          </Alert>
        ) : null}
        <SampleRecorder
          characters={characters.map((c) => c.hanzi)}
          preset={pilot?.next ?? null}
          defaultParticipant={participant}
        />
      </Card>
    </div>
  );
}
