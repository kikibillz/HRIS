import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const dir = mkdtempSync(join(tmpdir(), "hris-worker-"));
process.env.HRIS_DATA_DIR = dir;
process.env.HRIS_DEPLOYMENT = "production";
const { db } = await import("../lib/db.ts");
const { runScheduledReminders } =
  await import("../lib/onboarding-reminders.ts");
try {
  db.exec(`INSERT INTO departments(id,name) VALUES(1,'Test');
 INSERT INTO employees(id,name,email,role,department_id,joined) VALUES(1,'Test worker','test@example.test','Test',1,'2026-01-01');
 INSERT INTO company_employees VALUES(1,1);
 INSERT INTO accounts(id,employee_id,email,password_hash,access) VALUES(1,1,'test@example.test','not-a-real-hash','admin');
 INSERT INTO hr_records(id,company_id,kind,title,employee_id,due,created_by) VALUES(1,1,'onboarding_assignment','Test pack',1,'2026-10-01',1);
 INSERT INTO hr_records(company_id,kind,title,employee_id,due,reference_id,created_by) VALUES(1,'tasks','Test task',1,'2026-10-01',1,1);
 INSERT INTO onboarding_reminder_settings VALUES(1,1,9,1);`);
  const count = () =>
    Number(db.prepare("SELECT count(*) AS n FROM notifications").get().n);
  runScheduledReminders(new Date("2026-10-16T07:59:00Z"));
  assert.equal(count(), 0);
  runScheduledReminders(new Date("2026-10-16T08:00:00Z"));
  assert.equal(count(), 1);
  runScheduledReminders(new Date("2026-10-16T20:00:00Z"));
  assert.equal(count(), 1);
  // A restart after the scheduled hour catches today's batch, not missed days.
  runScheduledReminders(new Date("2026-10-19T20:00:00Z"));
  assert.equal(count(), 2);
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS n FROM onboarding_reminder_runs WHERE day IN ('2026-10-17','2026-10-18')",
      )
      .get().n,
    0,
  );
  db.exec(
    "CREATE TRIGGER fail_notification BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'test failure'); END;",
  );
  assert.equal(
    runScheduledReminders(new Date("2026-10-20T08:00:00Z")).failed,
    1,
  );
  assert.equal(count(), 2);
  assert.equal(
    db
      .prepare(
        "SELECT status FROM onboarding_reminder_runs WHERE day='2026-10-20'",
      )
      .get().status,
    "Failed",
  );
  db.exec("DROP TRIGGER fail_notification");
  runScheduledReminders(new Date("2026-10-20T08:01:00Z"));
  assert.equal(count(), 3);
  assert.equal(
    db
      .prepare(
        "SELECT status FROM onboarding_reminder_runs WHERE day='2026-10-20'",
      )
      .get().status,
    "Completed",
  );
  db.exec("UPDATE onboarding_reminder_settings SET enabled=0");
  runScheduledReminders(new Date("2026-10-21T08:00:00Z"));
  assert.equal(count(), 3);
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS n FROM onboarding_reminder_deliveries WHERE actor_id IS NULL",
      )
      .get().n,
    3,
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  const missing = join(dir, "missing");
  const result = spawnSync(
    process.execPath,
    ["scripts/onboarding-reminders.mjs", "--once"],
    { env: { ...process.env, HRIS_DATA_DIR: missing } },
  );
  assert.equal(result.status, 1);
  assert.equal(existsSync(missing), false);
  console.log(
    "PASS: schedule hour, catch-up without backlog, persistent daily keys, atomic failure/retry, disabled schedules, system attribution and missing-storage refusal.",
  );
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
