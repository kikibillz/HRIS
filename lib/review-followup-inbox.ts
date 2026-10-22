import { followupWorkloadSummaries } from "./review-followup-summaries";
import { db } from "./db";
import type { User } from "./auth";
import { audit, notify } from "./tenant";
import { onboardingDay } from "./onboarding-date";
import { validDate } from "./leave-policy";

export function followupInbox(user: User) {
  if (user.access !== "admin") throw Error("Administrator access required.");
  const owners = db
    .prepare(
      "SELECT ac.id,e.name FROM accounts ac JOIN employees e ON e.id=ac.employee_id JOIN company_employees ce ON ce.employee_id=e.id WHERE ce.company_id=? AND ac.access='admin' AND e.status='Active' ORDER BY e.name,ac.id",
    )
    .all(user.company_id);
  const requests = db
    .prepare(
      `SELECT f.id,f.record_id,f.employee_id,e.name AS employee_name,r.title AS review_title,f.question,f.status,f.created,
    resolution.note AS resolution_note,resolution.created AS resolved_at,
    assignment.owner_id,COALESCE(assignment.due,'') AS due,COALESCE(assignment.version,0) AS version,owner.name AS owner_name,
    CASE WHEN assignment.owner_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts active_account JOIN employees active_employee ON active_employee.id=active_account.employee_id JOIN company_employees active_company ON active_company.employee_id=active_employee.id WHERE active_account.id=assignment.owner_id AND active_company.company_id=f.company_id AND active_account.access='admin' AND active_employee.status='Active') THEN 1 ELSE 0 END AS owner_unavailable,
    CASE WHEN f.status='Open' AND assignment.due<>'' AND assignment.due<? THEN 1 ELSE 0 END AS overdue
    FROM review_followups f JOIN hr_records r ON r.id=f.record_id AND r.company_id=f.company_id JOIN employees e ON e.id=f.employee_id
    LEFT JOIN review_followup_resolutions resolution ON resolution.request_id=f.id
    LEFT JOIN review_followup_assignments assignment ON assignment.request_id=f.id
    LEFT JOIN accounts ac ON ac.id=assignment.owner_id LEFT JOIN employees owner ON owner.id=ac.employee_id
    WHERE f.company_id=? AND r.kind='reviews' AND r.status='Published' ORDER BY f.id DESC`,
    )
    .all(onboardingDay(), user.company_id);
  return {
    owners,
    summaries: followupWorkloadSummaries(user),
    requests: requests.map((request) => ({
      ...request,
      needs_escalation:
        request.status === "Open" &&
        (request.owner_id === null || request.owner_unavailable)
          ? 1
          : 0,
      alerts: db
        .prepare(
          "SELECT a.id,a.kind,a.day,a.reason,a.created,a.assignment_snapshot,(SELECT COUNT(*) FROM review_followup_alert_deliveries d WHERE d.alert_id=a.id) AS recipients FROM review_followup_alerts a WHERE a.request_id=? AND a.company_id=? ORDER BY a.id DESC",
        )
        .all(Number(request.id), user.company_id),
      history: db
        .prepare(
          "SELECT id,reason,before_snapshot,after_snapshot,created,actor_id FROM review_followup_assignment_events WHERE request_id=? AND company_id=? ORDER BY id DESC",
        )
        .all(Number(request.id), user.company_id),
    })),
  };
}
export function applyReviewFollowupAssignment(
  user: User,
  b: Record<string, unknown>,
) {
  if (user.access !== "admin") throw Error("Administrator access required.");
  if (
    !Number.isSafeInteger(b.request_id) ||
    Number(b.request_id) < 1 ||
    !Number.isSafeInteger(b.expected_version) ||
    Number(b.expected_version) < 0
  )
    throw Error("Invalid follow-up assignment version.");
  const due = typeof b.due === "string" ? b.due : "";
  if (b.due !== undefined && typeof b.due !== "string")
    throw Error("Enter a valid due date.");
  if (due && !validDate(due)) throw Error("Enter a valid due date.");
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (!reason || reason.length > 2000)
    throw Error("Provide an assignment reason of up to 2000 characters.");
  const owner = b.owner_id === null ? null : Number(b.owner_id);
  if (
    owner !== null &&
    (!Number.isSafeInteger(b.owner_id) || Number(b.owner_id) < 1)
  )
    throw Error("Choose an HR owner or unassigned.");
  const request = db
    .prepare(
      "SELECT f.id,f.status,f.record_id FROM review_followups f JOIN hr_records r ON r.id=f.record_id WHERE f.id=? AND f.company_id=? AND r.company_id=? AND r.status='Published' AND r.kind='reviews'",
    )
    .get(Number(b.request_id), user.company_id, user.company_id);
  if (!request) throw Error("Follow-up not found.");
  if (request.status !== "Open")
    throw Error("Resolved follow-ups cannot be reassigned.");
  const previous = db
    .prepare(
      "SELECT owner_id,due,version FROM review_followup_assignments WHERE request_id=? AND company_id=?",
    )
    .get(Number(request.id), user.company_id) ?? {
    owner_id: null,
    due: "",
    version: 0,
  };
  if (previous.version !== b.expected_version)
    throw Error(
      "The assignment changed. Refresh the inbox and review it again.",
    );
  const account =
    owner === null
      ? null
      : db
          .prepare(
            "SELECT ac.employee_id,e.name FROM accounts ac JOIN employees e ON e.id=ac.employee_id JOIN company_employees ce ON ce.employee_id=e.id WHERE ac.id=? AND ce.company_id=? AND ac.access='admin' AND e.status='Active'",
          )
          .get(owner, user.company_id);
  if (owner !== null && !account)
    throw Error("Choose an active HR administrator in this company.");
  if (previous.owner_id === owner && previous.due === due) {
    return { id: Number(request.id), unchanged: true };
  }
  const before = {
    ...previous,
    owner_name: previous.owner_id
      ? (db
          .prepare(
            "SELECT e.name FROM accounts ac JOIN employees e ON e.id=ac.employee_id WHERE ac.id=?",
          )
          .get(Number(previous.owner_id))?.name ?? null)
      : null,
  };
  const next = {
    owner_name: account?.name ?? null,
    owner_id: owner,
    due,
    version: Number(previous.version) + 1,
  };
  db.prepare(
    "INSERT INTO review_followup_assignments(request_id,company_id,owner_id,due,version,updated_by) VALUES (?,?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET owner_id=excluded.owner_id,due=excluded.due,version=excluded.version,updated_by=excluded.updated_by,updated=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
  ).run(Number(request.id), user.company_id, owner, due, next.version, user.id);
  db.prepare(
    "INSERT INTO review_followup_assignment_events(request_id,company_id,actor_id,reason,before_snapshot,after_snapshot) VALUES (?,?,?,?,?,?)",
  ).run(
    Number(request.id),
    user.company_id,
    user.id,
    reason,
    JSON.stringify(before),
    JSON.stringify(next),
  );
  audit(user, "Review follow-up assignment changed", String(request.id));
  if (account && owner !== previous.owner_id)
    notify(
      Number(account.employee_id),
      "Review follow-up assigned",
      `Follow-up #${request.id} · Review #${request.record_id}. Open Review follow-up inbox to review the employee's request.`,
    );
  return { id: Number(request.id), unchanged: false };
}
export function assignReviewFollowup(user: User, b: Record<string, unknown>) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = applyReviewFollowupAssignment(user, b);
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
