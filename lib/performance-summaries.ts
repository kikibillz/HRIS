import { createHash } from "node:crypto";
import { db } from "./db";
import type { User } from "./auth";
import { audit } from "./tenant";

export function savePerformanceSummary(user: User, b: Record<string, unknown>) {
  if (user.access !== "admin") throw Error("Administrator access required.");
  if (!Number.isSafeInteger(b.cycle_id) || Number(b.cycle_id) < 1)
    throw Error("Invalid cycle ID.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const cycle = db
      .prepare(
        "SELECT id,title,start,due,status FROM performance_cycles WHERE id=? AND company_id=?",
      )
      .get(Number(b.cycle_id), user.company_id);
    if (!cycle) throw Error("Cycle not found.");
    if (cycle.status !== "Closed")
      throw Error("Close the cycle before saving a completion summary.");
    const assignments = db
      .prepare(
        `SELECT r.id AS review_id,r.employee_id,e.name AS employee_name,r.reviewer_id,v.name AS reviewer_name,r.status,r.due,ack.created AS acknowledged_at,
      (SELECT MAX(day) FROM acknowledgment_reminders ar WHERE ar.record_id=r.id) AS last_acknowledgment_reminder,
      (SELECT COUNT(*) FROM acknowledgment_reminders ar WHERE ar.record_id=r.id) AS acknowledgment_reminder_count,
      EXISTS(SELECT 1 FROM accounts ac WHERE ac.employee_id=e.id) AND e.status='Active' AS can_remind_acknowledgment
      FROM performance_assignments a JOIN hr_records r ON r.id=a.record_id JOIN employees e ON e.id=r.employee_id JOIN employees v ON v.id=r.reviewer_id
      LEFT JOIN review_acknowledgments ack ON ack.record_id=r.id AND ack.company_id=r.company_id
      WHERE a.cycle_id=? AND r.company_id=? ORDER BY r.id`,
      )
      .all(Number(cycle.id), user.company_id);
    if (assignments.some((r) => r.status !== "Published"))
      throw Error(
        "All cycle reviews must remain published before saving a summary.",
      );
    const acknowledged = assignments.filter((r) => r.acknowledged_at).length;
    const snapshot = JSON.stringify({
      format: "peopleos-review-cycle-summary-v1",
      cycle,
      totals: {
        assigned: assignments.length,
        published: assignments.length,
        acknowledged,
        awaiting_acknowledgment: assignments.length - acknowledged,
        acknowledgment_percent: assignments.length
          ? Math.round((acknowledged / assignments.length) * 1000) / 10
          : null,
        unavailable_for_followup: assignments.filter(
          (r) => !r.acknowledged_at && !r.can_remind_acknowledgment,
        ).length,
      },
      assignments,
    });
    const hash = createHash("sha256").update(snapshot).digest("hex");
    const existing = db
      .prepare(
        "SELECT id FROM performance_summaries WHERE cycle_id=? AND company_id=? AND content_hash=?",
      )
      .get(Number(cycle.id), user.company_id, hash);
    let id = Number(existing?.id);
    if (!existing) {
      id = Number(
        db
          .prepare(
            "INSERT INTO performance_summaries(cycle_id,company_id,content_hash,snapshot,created_by) VALUES (?,?,?,?,?)",
          )
          .run(Number(cycle.id), user.company_id, hash, snapshot, user.id)
          .lastInsertRowid,
      );
      audit(user, "Performance completion summary saved", String(id));
    }
    db.exec("COMMIT");
    return { summary_id: id, reused: !!existing };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function performanceSummary(user: User, id: number) {
  if (user.access !== "admin") throw Error("Administrator access required.");
  return db
    .prepare(
      "SELECT id,cycle_id,created,created_by,content_hash,snapshot FROM performance_summaries WHERE id=? AND company_id=?",
    )
    .get(id, user.company_id);
}
