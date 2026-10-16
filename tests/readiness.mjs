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
  assert.equal(ready(dir), true);
  db.close();
  console.log("Readiness checks passed; missing storage is never initialized.");
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
