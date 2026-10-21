import { db } from "./db";
import type { User } from "./auth";
import { audit } from "./tenant";
import { onboardingDay } from "./onboarding-date";

export function followUpAcknowledgments(
  user: User,
  b: Record<string, unknown>,
) {
  if (user.access !== "admin") throw Error("Administrator access required.");
  if (!Number.isSafeInteger(b.cycle_id) || Number(b.cycle_id) < 1)
    throw Error("Invalid cycle ID.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const cycle = db
      .prepare("SELECT id FROM performance_cycles WHERE id=? AND company_id=?")
      .get(Number(b.cycle_id), user.company_id);
    if (!cycle) throw Error("Cycle not found.");
    const rows = db
      .prepare(
        `SELECT r.id,r.title,r.employee_id,e.status,
      EXISTS(SELECT 1 FROM accounts ac WHERE ac.employee_id=e.id) AS has_account
      FROM performance_assignments a JOIN hr_records r ON r.id=a.record_id
      JOIN employees e ON e.id=r.employee_id JOIN company_employees ce ON ce.employee_id=e.id AND ce.company_id=r.company_id
      WHERE a.cycle_id=? AND r.company_id=? AND r.status='Published'
      AND NOT EXISTS(SELECT 1 FROM review_acknowledgments ack WHERE ack.record_id=r.id)`,
      )
      .all(Number(cycle.id), user.company_id);
    const day = onboardingDay();
    let sent = 0,
      skipped = 0,
      unavailable = 0;
    for (const row of rows) {
      if (row.status !== "Active" || !row.has_account) {
        unavailable++;
        continue;
      }
      if (
        db
          .prepare(
            "SELECT 1 FROM acknowledgment_reminders WHERE record_id=? AND day=?",
          )
          .get(Number(row.id), day)
      ) {
        skipped++;
        continue;
      }
      const delivery = db
        .prepare(
          "INSERT INTO notifications(employee_id,title,body) VALUES (?,?,?)",
        )
        .run(
          Number(row.employee_id),
          "Review acknowledgment reminder",
          `${row.title} · Review #${row.id}. Open Performance reviews to read and acknowledge receipt. Acknowledgment records receipt, not agreement with the rating or outcome.`,
        );
      db.prepare(
        "INSERT INTO acknowledgment_reminders(record_id,day,company_id,employee_id,actor_id,notification_id) VALUES (?,?,?,?,?,?)",
      ).run(
        Number(row.id),
        day,
        user.company_id,
        Number(row.employee_id),
        user.id,
        Number(delivery.lastInsertRowid),
      );
      audit(user, "Review acknowledgment reminder sent", String(row.id));
      sent++;
    }
    db.exec("COMMIT");
    return { acknowledgment_reminders: true, sent, skipped, unavailable };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
