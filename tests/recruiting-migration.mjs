import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
const dir = mkdtempSync(join(tmpdir(), "hris-approval-migration-"));
process.env.HRIS_DATA_DIR = dir;
delete process.env.HRIS_DEPLOYMENT;
let { db } = await import("../lib/db.ts");
try {
  db.exec(`INSERT INTO accounts(id,employee_id,email,password_hash,access) VALUES (1,1,'maker@example.test','original-maker-hash','admin'),(2,2,'checker@example.test','original-checker-hash','manager');
 INSERT INTO hr_records(id,company_id,kind,title,created_by) VALUES(1,1,'applicants','Pending legacy',1),(2,1,'applicants','Approved legacy',1),(3,1,'applicants','Rejected legacy',1);
 DROP INDEX recruiting_one_open_pending;
 ALTER TABLE recruiting_approvals DROP COLUMN closed_state;
 CREATE UNIQUE INDEX recruiting_one_pending ON recruiting_approvals(applicant_id) WHERE status='Pending';`);
  for (const [i, status] of ["Pending", "Approved", "Rejected"].entries())
    db.prepare(
      "INSERT INTO recruiting_approvals(company_id,applicant_id,requested_by,approver_id,snapshot,snapshot_hash,status,request_note,decision_note,created,decided) VALUES(1,?,1,2,?,?,?,?,?,?,?)",
    ).run(
      i + 1,
      `original frozen ${status}`,
      `hash-${status}`,
      status,
      `request-${status}`,
      status === "Pending" ? "" : `decision-${status}`,
      "2026-10-01T00:00:00Z",
      status === "Pending" ? null : "2026-10-02T00:00:00Z",
    );
  const columns = db
    .prepare("PRAGMA table_info(recruiting_approvals)")
    .all()
    .map((c) => c.name)
    .join(",");
  const original = db
    .prepare(`SELECT ${columns} FROM recruiting_approvals ORDER BY id`)
    .all();
  const accounts = db.prepare("SELECT * FROM accounts ORDER BY id").all();
  db.close();
  for (let i = 0; i < 2; i++) {
    const r = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const {db}=await import('./lib/db.ts');db.close();",
      ],
      { env: { ...process.env, HRIS_DEPLOYMENT: "production" } },
    );
    assert.equal(r.status, 0, r.stderr.toString());
    db = new DatabaseSync(join(dir, "hris.sqlite"));
    assert.deepEqual(
      db
        .prepare(`SELECT ${columns} FROM recruiting_approvals ORDER BY id`)
        .all(),
      original,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM accounts ORDER BY id").all(),
      accounts,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM recruiting_approvals WHERE closed_state='' ",
        )
        .get().n,
      3,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name='recruiting_one_pending'",
        )
        .get().n,
      0,
    );
    db.close();
  }
  db = new DatabaseSync(join(dir, "hris.sqlite"));
  assert.throws(
    () =>
      db.exec(
        "INSERT INTO recruiting_approvals(company_id,applicant_id,requested_by,approver_id,snapshot,snapshot_hash,request_note) VALUES(1,1,1,2,'new','new','new')",
      ),
    /UNIQUE/,
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  console.log(
    "PASS: repeatable legacy approval migration preserves pending requests, completed decisions, frozen evidence, timestamps, accounts and password hashes.",
  );
} finally {
  try {
    db.close();
  } catch {}
  rmSync(dir, { recursive: true, force: true });
}
