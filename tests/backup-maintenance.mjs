import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = mkdtempSync(join(tmpdir(), "hris-ops-test-")),
  live = join(root, "live"),
  destination = join(root, "archives"),
  scratch = join(root, "scratch"),
  key = join(root, "backup.key");
for (const p of [live, destination, scratch]) mkdirSync(p, { mode: 0o700 });
const secret = randomBytes(32).toString("base64url");
writeFileSync(key, secret + "\n", { mode: 0o600 });
const env = {
  ...process.env,
  HRIS_DATA_DIR: live,
  HRIS_DEPLOYMENT: "production",
  HRIS_BACKUP_DIR: destination,
  HRIS_BACKUP_KEY_FILE: key,
  HRIS_BACKUP_ALLOW_LOCAL: "1",
  HRIS_MIN_FREE_BYTES: "1",
  HRIS_MONITOR_ORIGIN: "",
  TMPDIR: scratch,
};
const run = (script, overrides = {}) => {
  const r = spawnSync(process.execPath, [script], {
    env: { ...env, ...overrides },
    encoding: "utf8",
    timeout: 30000,
  });
  assert(!r.error, r.error?.message);
  assert(
    !r.stdout.includes(secret) && !r.stderr.includes(secret),
    "Never disclose key",
  );
  return r;
};
const maintenance = (overrides = {}) =>
  run("scripts/backup-maintenance.mjs", overrides);
const monitor = (overrides = {}) => {
  const r = run("scripts/operations-check.mjs", overrides);
  return { ...r, report: JSON.parse(r.stdout) };
};
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
let db;
try {
  let initial = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      'const {db}=await import("./lib/db.ts");db.close()',
    ],
    { env, encoding: "utf8" },
  );
  assert.equal(initial.status, 0, initial.stderr);
  db = new DatabaseSync(join(live, "hris.sqlite"));
  db.exec(`PRAGMA foreign_keys=ON;
 INSERT INTO departments(id,name) VALUES(1,'Fixture department');
 INSERT INTO employees(id,name,email,role,department_id,joined) VALUES(1,'Preserved person','ops@example.test','HR',1,'2026-01-01');
 INSERT INTO company_employees VALUES(1,1);
 INSERT INTO accounts(id,employee_id,email,password_hash,access) VALUES(1,1,'ops@example.test','preserved-test-password-hash','admin');
 INSERT INTO sessions VALUES('fixture-session',1,9999999999999);`);
  const snapshot = () =>
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all()]);
  const original = snapshot();
  assert.equal(monitor().status, 1, "Missing backup needs attention");
  assert.notEqual(
    maintenance({ HRIS_BACKUP_ALLOW_LOCAL: "" }).status,
    0,
    "Do not silently fall back to local backups",
  );
  assert.notEqual(maintenance({ HRIS_BACKUP_DIR: live }).status, 0);
  assert.notEqual(maintenance({ HRIS_BACKUP_RETENTION_DAYS: "0" }).status, 0);
  chmodSync(key, 0o644);
  assert.notEqual(maintenance().status, 0);
  chmodSync(key, 0o600);
  const missing = join(root, "missing");
  mkdirSync(missing);
  assert.notEqual(maintenance({ HRIS_DATA_DIR: missing }).status, 0);
  assert(!existsSync(join(missing, "hris.sqlite")));
  mkdirSync(join(destination, ".hris-backup.lock"));
  assert.notEqual(maintenance().status, 0);
  rmSync(join(destination, ".hris-backup.lock"), { recursive: true });
  const result = maintenance();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).restore_drill, true);
  assert.deepEqual(
    snapshot(),
    original,
    "Restore drill never changes live accounts or data",
  );
  assert.deepEqual(readdirSync(scratch), [], "Drill plaintext removed");
  const successPath = join(destination, "last-success.json"),
    first = json(successPath),
    firstArchive = join(destination, first.archive);
  assert.equal(statSync(firstArchive).mode & 0o777, 0o600);
  assert.equal(statSync(successPath).mode & 0o777, 0o600);
  assert.equal(first.destination_kind, "local-test");
  assert.equal(monitor().status, 0);
  assert.equal(
    monitor({ HRIS_BACKUP_ALLOW_LOCAL: "" }).status,
    1,
    "Local rehearsal is not a production offsite check",
  );
  writeFileSync(
    successPath,
    JSON.stringify({
      ...first,
      created: new Date(Date.now() - 40 * 86400000).toISOString(),
    }),
  );
  assert.equal(monitor().report.checks.backup.ok, false);
  writeFileSync(successPath, JSON.stringify(first));
  db.exec("INSERT INTO onboarding_reminder_settings VALUES(1,1,9,1)");
  assert.equal(monitor().report.checks.reminder_worker.ok, false);
  db.prepare(
    "INSERT INTO onboarding_worker_state(id,last_tick,last_error) VALUES(1,?,?)",
  ).run(new Date().toISOString(), "");
  assert.equal(monitor().status, 0);
  db.prepare("UPDATE onboarding_worker_state SET last_tick=?").run(
    "2020-01-01T00:00:00Z",
  );
  assert.equal(monitor().report.checks.reminder_worker.ok, false);
  db.prepare("UPDATE onboarding_worker_state SET last_tick=?,last_error=?").run(
    new Date().toISOString(),
    "fixture failure",
  );
  assert.equal(monitor().report.checks.reminder_worker.ok, false);
  db.exec("UPDATE onboarding_reminder_settings SET enabled=0");
  const oldManifest = firstArchive + ".verified.json";
  writeFileSync(
    oldManifest,
    JSON.stringify({
      ...first,
      created: new Date(Date.now() - 40 * 86400000).toISOString(),
    }),
  );
  writeFileSync(join(destination, "manual.hrisbackup"), "unmanaged archive");
  // A failed backup keeps the prior good backup and does not run retention.
  db.exec("ALTER TABLE payroll_runs RENAME TO unavailable_fixture");
  assert.notEqual(maintenance().status, 0);
  assert(existsSync(firstArchive));
  assert.deepEqual(json(successPath), first);
  assert.equal(json(join(destination, "last-attempt.json")).status, "failed");
  assert.equal(monitor().report.checks.backup.ok, false);
  db.exec("ALTER TABLE unavailable_fixture RENAME TO payroll_runs");
  const next = maintenance();
  assert.equal(next.status, 0, next.stderr);
  assert.equal(JSON.parse(next.stdout).pruned, 1);
  assert(!existsSync(firstArchive));
  assert(existsSync(join(destination, "manual.hrisbackup")));
  assert.equal(monitor().status, 0);
  const latest = json(successPath),
    latestArchive = join(destination, latest.archive);
  const bytes = readFileSync(latestArchive);
  bytes[bytes.length - 1] ^= 1;
  writeFileSync(latestArchive, bytes);
  assert.equal(
    monitor().report.checks.backup.ok,
    false,
    "Detect corrupted retained backup",
  );
  assert.deepEqual(
    db.prepare("SELECT * FROM accounts").all(),
    original.find(([name]) => name === "accounts")[1],
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  console.log(
    "PASS: encrypted scheduled backup, isolated restore drill, unchanged live accounts, private key/files, lock/no-local-fallback, verified retention, failure preservation, stale/corrupt backup checks and worker monitoring.",
  );
} finally {
  db?.close();
  rmSync(root, { recursive: true, force: true });
}
