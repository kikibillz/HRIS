import { db } from "./db";
import type { User } from "./auth";
import { audit } from "./tenant";
import { onboardingDay } from "./onboarding-date";
export function alertReviewFollowup(user: User, b: Record<string, unknown>) {
  if (user.access !== "admin") throw Error("Administrator access required.");
  if (
    !Number.isSafeInteger(b.request_id) ||
    Number(b.request_id) < 1 ||
    !Number.isSafeInteger(b.expected_version) ||
    Number(b.expected_version) < 0
  )
    throw Error("Invalid follow-up assignment version.");
  const kind = b.action === "remind_owner" ? "owner_reminder" : "escalation";
  const reason =
    kind === "owner_reminder"
      ? "Overdue HR follow-up"
      : typeof b.reason === "string"
        ? b.reason.trim()
        : "";
  if (!reason || reason.length > 2000)
    throw Error("Provide an escalation reason of up to 2000 characters.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        `SELECT f.id,f.record_id,f.status,assignment.owner_id,COALESCE(assignment.due,'') AS due,COALESCE(assignment.version,0) AS version FROM review_followups f JOIN hr_records r ON r.id=f.record_id
      LEFT JOIN review_followup_assignments assignment ON assignment.request_id=f.id
      WHERE f.id=? AND f.company_id=? AND r.company_id=? AND r.kind='reviews' AND r.status='Published'`,
      )
      .get(Number(b.request_id), user.company_id, user.company_id);
    if (!row) throw Error("Follow-up not found.");
    if (row.status !== "Open")
      throw Error(
        "Resolved follow-ups do not receive reminders or escalation.",
      );
    if (row.version !== b.expected_version)
      throw Error(
        "The assignment changed. Refresh the inbox and review it again.",
      );
    const day = onboardingDay();
    const admins = db
      .prepare(
        "SELECT ac.id,ac.employee_id,e.name FROM accounts ac JOIN employees e ON e.id=ac.employee_id JOIN company_employees ce ON ce.employee_id=e.id WHERE ce.company_id=? AND ac.access='admin' AND e.status='Active' ORDER BY ac.id",
      )
      .all(user.company_id);
    const owner = admins.find((admin) => admin.id === row.owner_id);
    if (
      kind === "owner_reminder" &&
      (!owner || !row.due || String(row.due) >= day)
    )
      throw Error("Choose an overdue open request with an available HR owner.");
    if (kind === "escalation" && owner)
      throw Error(
        "This request already has an available HR owner. Use the owner reminder when overdue.",
      );
    const existing = db
      .prepare(
        "SELECT id FROM review_followup_alerts WHERE request_id=? AND kind=? AND day=?",
      )
      .get(Number(row.id), kind, day);
    if (existing) {
      db.exec("COMMIT");
      return {
        alert: true,
        kind,
        sent: 0,
        already_sent: true,
        id: Number(existing.id),
      };
    }
    const recipients = kind === "owner_reminder" ? [owner!] : admins;
    if (!recipients.length)
      throw Error("No active HR administrators are available.");
    const id = Number(
      db
        .prepare(
          "INSERT INTO review_followup_alerts(request_id,company_id,kind,day,actor_id,reason,assignment_snapshot) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          Number(row.id),
          user.company_id,
          kind,
          day,
          user.id,
          reason,
          JSON.stringify({ ...row, owner_name: owner?.name ?? null }),
        ).lastInsertRowid,
    );
    for (const recipient of recipients) {
      const notification = db
        .prepare(
          "INSERT INTO notifications(employee_id,title,body) VALUES (?,?,?)",
        )
        .run(
          Number(recipient.employee_id),
          kind === "owner_reminder"
            ? "Overdue review follow-up"
            : "Review follow-up needs an HR owner",
          `Follow-up #${row.id} · Review #${row.record_id}. Open Review follow-up inbox to ${kind === "owner_reminder" ? "review your overdue assignment" : "assign an available HR owner"}.`,
        );
      db.prepare(
        "INSERT INTO review_followup_alert_deliveries(alert_id,account_id,notification_id) VALUES (?,?,?)",
      ).run(id, Number(recipient.id), Number(notification.lastInsertRowid));
    }
    audit(
      user,
      kind === "owner_reminder"
        ? "Review follow-up owner reminded"
        : "Review follow-up escalated",
      String(row.id),
    );
    db.exec("COMMIT");
    return {
      alert: true,
      kind,
      sent: recipients.length,
      already_sent: false,
      id,
    };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
