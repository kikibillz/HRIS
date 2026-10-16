import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
if (
  Number(process.versions.node.split(".")[0]) !== 24 ||
  !process.env.HRIS_DATA_DIR ||
  !isAbsolute(process.env.HRIS_DATA_DIR) ||
  !existsSync(join(process.env.HRIS_DATA_DIR, "hris.sqlite")) ||
  !["--once", "--watch"].includes(process.argv[2])
) {
  console.error(
    "Requires Node 24, an existing absolute HRIS_DATA_DIR, and --once or --watch.",
  );
  process.exit(1);
}
process.env.HRIS_DEPLOYMENT = "production";
const { runScheduledReminders } =
  await import("../lib/onboarding-reminders.ts");
let failed = false;
function tick() {
  try {
    const result = runScheduledReminders();
    failed = result.failed > 0;
    if (failed)
      console.error("Reminder batch failed; see company delivery monitor.");
  } catch {
    failed = true;
    console.error("Reminder worker failed; check database availability.");
  }
}
tick();
if (process.argv[2] === "--watch") setInterval(tick, 60_000);
else process.exitCode = failed ? 1 : 0;
