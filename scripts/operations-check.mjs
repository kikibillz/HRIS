#!/usr/bin/env node
// Read-only operator monitor. Does not migrate storage or send external alerts.
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath, statfs } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { ready } from "../lib/readiness.ts";
const checks = {};
async function check(name, work) {
  try {
    checks[name] = await work();
  } catch {
    checks[name] = { ok: false };
  }
}
const hash = async (path) => {
  const h = createHash("sha256");
  for await (const b of createReadStream(path)) h.update(b);
  return h.digest("hex");
};
let source;
await check("database", async () => {
  if (
    Number(process.versions.node.split(".")[0]) !== 24 ||
    !process.env.HRIS_DATA_DIR ||
    !isAbsolute(process.env.HRIS_DATA_DIR)
  )
    return { ok: false };
  source = await realpath(process.env.HRIS_DATA_DIR);
  return { ok: ready(source) };
});
await check("storage", async () => {
  const minimum = Number(process.env.HRIS_MIN_FREE_BYTES || 1073741824);
  if (!source || !Number.isSafeInteger(minimum) || minimum < 1)
    return { ok: false };
  const info = await statfs(source),
    available = Number(info.bavail) * Number(info.bsize);
  return {
    ok: available >= minimum,
    available_bytes: available,
    minimum_bytes: minimum,
  };
});
await check("backup", async () => {
  if (
    !source ||
    !process.env.HRIS_BACKUP_DIR ||
    !isAbsolute(process.env.HRIS_BACKUP_DIR)
  )
    return { ok: false };
  const dir = await realpath(process.env.HRIS_BACKUP_DIR),
    report = JSON.parse(await readFile(join(dir, "last-success.json"), "utf8"));
  const hours = Number(process.env.HRIS_BACKUP_MAX_AGE_HOURS || 36),
    age = Date.now() - Date.parse(report.created);
  if (
    !Number.isFinite(hours) ||
    hours < 1 ||
    hours > 8760 ||
    report.format !== "hris-backup-maintenance-v1" ||
    report.source_id !== createHash("sha256").update(source).digest("hex") ||
    report.restore_drill !== true ||
    (report.destination_kind === "local-test" &&
      process.env.HRIS_BACKUP_ALLOW_LOCAL !== "1") ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > hours * 3600000 ||
    !/^hris-auto-[0-9T.Z-]+-[0-9a-f-]{36}\.hrisbackup$/.test(report.archive)
  )
    return { ok: false };
  if (report.destination_kind !== "local-test") {
    if (
      !process.env.HRIS_BACKUP_MOUNT ||
      !isAbsolute(process.env.HRIS_BACKUP_MOUNT)
    )
      return { ok: false };
    const mount = await realpath(process.env.HRIS_BACKUP_MOUNT);
    const contains = (path) => {
      const part = relative(mount, path);
      return part === "" || (!part.startsWith("..") && !isAbsolute(part));
    };
    const mounted = (await readFile("/proc/self/mountinfo", "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) =>
        line
          .split(" ")[4]
          .replace(/\\([0-7]{3})/g, (_, oct) =>
            String.fromCharCode(parseInt(oct, 8)),
          ),
      );
    if (
      mount === "/" ||
      !mounted.includes(mount) ||
      !contains(dir) ||
      contains(source)
    )
      return { ok: false };
  }
  const archive = join(dir, report.archive),
    info = await lstat(archive);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (await hash(archive)) !== report.archive_sha256
  )
    return { ok: false };
  const last = JSON.parse(
    await readFile(join(dir, "last-attempt.json"), "utf8"),
  );
  return {
    ok: last.status === "ok" && last.archive === report.archive,
    age_hours: Math.round(age / 36000) / 100,
    restore_drill: true,
    destination_kind: report.destination_kind,
  };
});
await check("reminder_worker", async () => {
  if (!source || !checks.database.ok) return { ok: false };
  const db = new DatabaseSync(join(source, "hris.sqlite"), { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=1000");
    if (
      !db
        .prepare(
          "SELECT 1 FROM onboarding_reminder_settings WHERE enabled=1 LIMIT 1",
        )
        .get()
    )
      return { ok: true, required: false };
    const state = db
      .prepare(
        "SELECT last_tick,last_error FROM onboarding_worker_state WHERE id=1",
      )
      .get();
    const age = state ? Date.now() - Date.parse(state.last_tick) : NaN;
    return {
      ok: Number.isFinite(age) && age >= 0 && age < 180000 && !state.last_error,
      required: true,
    };
  } finally {
    db.close();
  }
});
if (process.env.HRIS_MONITOR_ORIGIN)
  await check("http", async () => {
    const origin = process.env.HRIS_MONITOR_ORIGIN,
      url = new URL(origin);
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      )
    )
      return { ok: false };
    const response = await fetch(origin + "/api/health/ready", {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    return { ok: response.ok && (await response.json()).status === "ready" };
  });
const ok = Object.values(checks).every((value) => value.ok);
console.log(
  JSON.stringify({
    status: ok ? "ok" : "attention",
    checked: new Date().toISOString(),
    checks,
  }),
);
process.exitCode = ok ? 0 : 1;
