import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ready } from "../lib/readiness.ts";
const dir = mkdtempSync(join(tmpdir(), "hris-ready-"));
try {
  assert.equal(ready(dir), false);
  assert.equal(existsSync(join(dir, "hris.sqlite")), false);
  const db = new DatabaseSync(join(dir, "hris.sqlite"));
  assert.equal(ready(dir), false);
  for (const name of [
    "accounts",
    "companies",
    "employees",
    "company_recovery_identity",
  ])
    db.exec(`CREATE TABLE ${name}(id INTEGER)`);
  // The old core-only schema must not report ready for the current application.
  assert.equal(ready(dir), false);
  db.close();
  rmSync(join(dir, "hris.sqlite"));
  const migrated = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      'const {db}=await import("./lib/db.ts");db.close();',
    ],
    {
      env: {
        ...process.env,
        HRIS_DATA_DIR: dir,
        HRIS_DEPLOYMENT: "production",
      },
      encoding: "utf8",
    },
  );
  assert.equal(migrated.status, 0, migrated.stderr);
  const fixture = new DatabaseSync(join(dir, "hris.sqlite"));
  assert.equal(ready(dir), true);
  const schema = () =>
    fixture
      .prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name")
      .all();
  const unchanged = schema();
  assert.equal(ready(dir), true);
  assert.deepEqual(schema(), unchanged);
  for (const table of [
    "hr_records",
    "performance_cycles",
    "performance_assignments",
    "review_acknowledgments",
    "review_followup_resolutions",
    "review_followup_alert_deliveries",
    "review_followup_batches",
    "review_followup_views",
  ]) {
    fixture.exec(`ALTER TABLE ${table} RENAME TO unavailable_fixture`);
    const incomplete = schema();
    assert.equal(ready(dir), false, `Missing ${table} must fail readiness`);
    assert.deepEqual(schema(), incomplete, "Readiness must not repair storage");
    fixture.exec(`ALTER TABLE unavailable_fixture RENAME TO ${table}`);
    assert.equal(ready(dir), true);
  }
  for (const [table, column] of [
    ["review_followup_views", "pinned"],
    ["review_followup_batches", "actor_name"],
  ]) {
    fixture.exec(
      `ALTER TABLE ${table} RENAME COLUMN ${column} TO unavailable_column`,
    );
    assert.equal(
      ready(dir),
      false,
      `Missing ${column} migration must fail readiness`,
    );
    fixture.exec(
      `ALTER TABLE ${table} RENAME COLUMN unavailable_column TO ${column}`,
    );
    assert.equal(ready(dir), true);
  }
  assert.deepEqual(fixture.prepare("PRAGMA foreign_key_check").all(), []);
  fixture.close();
  console.log(
    "Readiness checks passed; incomplete review migrations are rejected and storage is never initialized or repaired.",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

for (const overrides of [
  { HRIS_DATA_DIR: "relative", HRIS_PUBLIC_ORIGIN: "https://hr.example.com" },
  {
    HRIS_DATA_DIR: "/tmp/hris-not-created",
    HRIS_PUBLIC_ORIGIN: "http://hr.example.com",
  },
  {
    HRIS_DATA_DIR: "/tmp/hris-not-created",
    HRIS_PUBLIC_ORIGIN: "https://hr.example.com",
    HRIS_ALLOW_SETUP: "1",
  },
]) {
  const result = spawnSync(process.execPath, ["scripts/start-production.mjs"], {
    env: { ...process.env, HRIS_ALLOW_SETUP: "0", ...overrides },
  });
  assert.equal(result.status, 1);
}
console.log("Unsafe production startup settings rejected.");
