/**
 * M13 coverage sketch: SYNTHETIC data only. Never reads the database or any participant data.
 *
 * For clustered binary data with a known true rate p and intra-writer correlation ρ
 * (beta-binomial writers, 20 samples each, one look, α = 0.05), how often does each one-sided
 * upper bound reach the true rate (coverage, nominally 95 %), and how often does it "pass" a
 * target? It's input for the independent statistical review
 * (docs/M13_STATISTICAL_REVIEW_PROPOSAL.md), not a validation of anything.
 *
 *   npx tsx scripts/m13-coverage-sketch.ts [repetitions = 1000]
 *
 * Deterministic: a fixed seed for the simulation and per-repetition bootstrap seeds.
 */
import { decisionBound, type WriterCount } from "../src/features/handwriting/validation-stats";

let s = 12345;
const rand = () => {
  s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
  return (s + 0.5) / 4294967296;
};
function gamma(k: number): number {
  if (k < 1) return gamma(k + 1) * rand() ** (1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand());
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    if (Math.log(rand()) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
  }
}
function simulate(W: number, m: number, p: number, rho: number): WriterCount[] {
  const t = 1 / rho - 1; // a + b
  return Array.from({ length: W }, () => {
    const g1 = gamma(p * t);
    const q = g1 / (g1 + gamma((1 - p) * t));
    let e = 0;
    for (let i = 0; i < m; i += 1) if (rand() < q) e += 1;
    return { events: e, n: m };
  });
}

const reps = Number(process.argv[2] ?? 1000);
const rows: string[] = [];
for (const [W, p, rho, target] of [
  [40, 0.0025, 0.05, 0.01],
  [40, 0.0025, 0.1, 0.01],
  [40, 0.005, 0.1, 0.01],
  [40, 0.01, 0.1, 0.01],
  [40, 0.02, 0.1, 0.03],
  [40, 0.05, 0.2, 0.1],
  [120, 0.0025, 0.1, 0.01],
  [120, 0.01, 0.1, 0.01],
] as const) {
  const c = { boot: 0, exact: 0, cons: 0, wilson: 0 };
  const pass = { boot: 0, exact: 0, cons: 0 };
  let bootUsed = 0;
  for (let r = 0; r < reps; r += 1) {
    const b = decisionBound(simulate(W, 20, p, rho), { replicates: 1000, seed: r + 1 });
    const bootU = b.bootstrap ? b.bootstrap[1] : b.exactUpper!;
    if (b.bootstrap) bootUsed += 1;
    if (bootU >= p) c.boot += 1;
    if (b.exactUpper! >= p) c.exact += 1;
    if (b.upper! >= p) c.cons += 1;
    if (b.naiveWilson![1] >= p) c.wilson += 1;
    if (bootU <= target) pass.boot += 1;
    if (b.exactUpper! <= target) pass.exact += 1;
    if (b.upper! <= target) pass.cons += 1;
  }
  const pct = (x: number) => `${((100 * x) / reps).toFixed(1)}%`;
  rows.push(
    `| ${W} | ${(p * 100).toFixed(2)} % | ${rho} | ${(target * 100).toFixed(0)} % | ${pct(c.boot)} | ${pct(c.exact)} | ${pct(c.cons)} | ${pct(c.wilson)} | ${pct(pass.boot)} | ${pct(pass.exact)} | ${pct(pass.cons)} | ${pct(bootUsed)} |`,
  );
}
console.log(
  "| Writers | True rate | ρ | Target | Cover: §3 rule | Cover: exact eff-n | Cover: worse-of-two | Cover: naive Wilson | Pass: §3 | Pass: exact | Pass: worse-of-two | Bootstrap available |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const r of rows) console.log(r);
