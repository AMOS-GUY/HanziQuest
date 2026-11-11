/**
 * Node-only start-up work, imported by `instrumentation.ts` in the Node.js runtime only (so
 * `process.exit` never reaches the Edge bundle).
 *
 * Configuration check: on a fatal problem, exit instead of throwing (M10-12). Next.js logs a
 * throwing register() as "Failed to prepare server" and keeps the process running, so a
 * misconfigured instance would stay up and pass liveness. Exiting makes the platform mark the
 * deploy as failed and keep the previous release serving.
 */
import { checkEnvironment } from "@/lib/env";

const issues = checkEnvironment();
for (const i of issues) console[i.fatal ? "error" : "warn"](`[config] ${i.name} ${i.problem}`);
const fatal = issues.filter((i) => i.fatal);
if (fatal.length > 0 && process.env.SKIP_ENV_CHECK !== "true") {
  console.error(`[config] Invalid configuration: ${fatal.map((i) => i.name).join(", ")}`);
  process.exit(1);
}
