import { isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
function fail(message) {
  console.error(message);
  process.exit(1);
}
if (Number(process.versions.node.split(".")[0]) !== 24)
  fail("Production requires Node.js 24.");
if (!process.env.HRIS_DATA_DIR || !isAbsolute(process.env.HRIS_DATA_DIR))
  fail("Set HRIS_DATA_DIR to an absolute persistent storage path.");
try {
  const url = new URL(process.env.HRIS_PUBLIC_ORIGIN);
  if (
    url.protocol !== "https:" ||
    url.origin !== process.env.HRIS_PUBLIC_ORIGIN ||
    url.username ||
    url.password
  )
    throw Error();
} catch {
  fail(
    "Set HRIS_PUBLIC_ORIGIN to the exact HTTPS origin, without a trailing slash.",
  );
}
if (process.env.HRIS_ALLOW_SETUP === "1")
  fail("Disable HRIS_ALLOW_SETUP for production.");
process.env.HRIS_DEPLOYMENT = "production";
process.env.NODE_ENV = "production";
const server = existsSync("server.js")
  ? "server.js"
  : ".next/standalone/server.js";
if (!existsSync(server))
  fail("Build the standalone server before starting production.");
// Apply additive migrations before accepting traffic. Existing records are retained.
const { db } = await import("../lib/db.ts");
db.close();
const child = spawn(process.execPath, [server], {
  stdio: "inherit",
  env: process.env,
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("error", () => fail("Unable to start the production server."));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
