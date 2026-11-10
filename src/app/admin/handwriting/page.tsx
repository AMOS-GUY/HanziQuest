import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { prisma } from "@/lib/database/prisma";
import { requirePagePermission } from "@/lib/auth/session";
import { analyseSamples } from "@/features/handwriting/samples";
import { ENGINE_VERSION } from "@/features/handwriting/evaluate";
import { CATEGORY_LABEL, formatRate } from "@/features/handwriting/validation";
import { SampleRecorder } from "./sample-recorder";

export const metadata = { title: "Handwriting lab" };
export const dynamic = "force-dynamic";

export default async function HandwritingLabPage() {
  await requirePagePermission("handwriting:validate");
  const [characters, { metrics }] = await Promise.all([
    prisma.character.findMany({
      where: { hasStrokeData: true, lessons: { some: {} } },
      orderBy: { createdAt: "asc" },
      select: { hanzi: true },
    }),
    analyseSamples(prisma),
  ]);

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
        <div className="overflow-x-auto">
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
        <CardTitle className="mb-4">Record a sample</CardTitle>
        <SampleRecorder characters={characters.map((c) => c.hanzi)} />
      </Card>
    </div>
  );
}
