import { createHash } from "node:crypto";
import { db } from "./db";
import type { User } from "./auth";
import { audit } from "./tenant";
import { onboardingDay } from "./onboarding-date";
export function followupWorkloadSummaries(user: User) {
  if (user.access !== "admin") throw Error("Administrator access required.");
  return db
    .prepare(
      "SELECT id,content_hash,created,created_by,snapshot FROM review_followup_summaries WHERE company_id=? ORDER BY id DESC",
    )
    .all(user.company_id)
    .map(({ snapshot, ...row }) => {
      const saved = JSON.parse(String(snapshot));
      return { ...row, as_of_day: saved.as_of_day, totals: saved.totals };
    });
}
export function followupWorkloadSummary(user: User, id: number) {
  if (user.access !== "admin") throw Error("Administrator access required.");
  return db
    .prepare(
      "SELECT id,content_hash,created,created_by,snapshot FROM review_followup_summaries WHERE id=? AND company_id=?",
    )
    .get(id, user.company_id);
}
export function saveFollowupWorkloadSummary(user: User) {
  if (user.access !== "admin") throw Error("Administrator access required.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const day = onboardingDay();
    const requests = db
      .prepare(
        `SELECT f.id AS request_id,f.record_id,f.employee_id,employee.name AS employee_name,f.status,f.created,resolution.created AS resolved_at,
      assignment.owner_id,owner.name AS owner_name,COALESCE(assignment.due,'') AS due,COALESCE(assignment.version,0) AS assignment_version,
      CASE WHEN assignment.owner_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts active_account JOIN employees active_employee ON active_employee.id=active_account.employee_id JOIN company_employees ce ON ce.employee_id=active_employee.id WHERE active_account.id=assignment.owner_id AND ce.company_id=f.company_id AND active_account.access='admin' AND active_employee.status='Active') THEN 1 ELSE 0 END AS owner_unavailable,
      CASE WHEN f.status='Open' AND assignment.due<>'' AND assignment.due<? THEN 1 ELSE 0 END AS overdue,
      (SELECT COUNT(*) FROM review_followup_alerts alert WHERE alert.request_id=f.id AND alert.kind='owner_reminder') AS owner_reminders,
      (SELECT COUNT(*) FROM review_followup_alerts alert WHERE alert.request_id=f.id AND alert.kind='escalation') AS escalations,
      (SELECT MAX(created) FROM review_followup_alerts alert WHERE alert.request_id=f.id AND alert.kind='owner_reminder') AS last_owner_reminder,
      (SELECT MAX(created) FROM review_followup_alerts alert WHERE alert.request_id=f.id AND alert.kind='escalation') AS last_escalation
      FROM review_followups f JOIN hr_records r ON r.id=f.record_id AND r.company_id=f.company_id
      JOIN employees employee ON employee.id=f.employee_id
      LEFT JOIN review_followup_resolutions resolution ON resolution.request_id=f.id
      LEFT JOIN review_followup_assignments assignment ON assignment.request_id=f.id
      LEFT JOIN accounts ac ON ac.id=assignment.owner_id LEFT JOIN employees owner ON owner.id=ac.employee_id
      WHERE f.company_id=? AND r.kind='reviews' AND r.status='Published' ORDER BY f.id`,
      )
      .all(day, user.company_id);
    const open = requests.filter((row) => row.status === "Open");
    const owners = new Map<
      number | null,
      {
        owner_id: number | null;
        owner_name: string;
        open: number;
        overdue: number;
        resolved: number;
      }
    >();
    for (const row of requests) {
      const id = row.owner_id === null ? null : Number(row.owner_id);
      const bucket = owners.get(id) ?? {
        owner_id: id,
        owner_name: String(row.owner_name ?? "Unassigned"),
        open: 0,
        overdue: 0,
        resolved: 0,
      };
      if (row.status === "Open") {
        bucket.open++;
        if (row.overdue) bucket.overdue++;
      } else bucket.resolved++;
      owners.set(id, bucket);
    }
    const snapshot = JSON.stringify({
      format: "peopleos-hr-followup-workload-v1",
      as_of_day: day,
      timezone: "Africa/Lagos",
      scope: "All company review follow-ups",
      totals: {
        total: requests.length,
        open: open.length,
        resolved: requests.length - open.length,
        overdue: open.filter((row) => row.overdue).length,
        unassigned: open.filter((row) => row.owner_id === null).length,
        unavailable_owner: open.filter(
          (row) => row.owner_id !== null && row.owner_unavailable,
        ).length,
        needs_hr_owner: open.filter(
          (row) => row.owner_id === null || row.owner_unavailable,
        ).length,
        due_today: open.filter((row) => row.due === day).length,
        without_due: open.filter((row) => !row.due).length,
      },
      by_owner: [...owners.values()].sort(
        (a, b) => (a.owner_id ?? 0) - (b.owner_id ?? 0),
      ),
      requests,
    });
    const hash = createHash("sha256").update(snapshot).digest("hex");
    const existing = db
      .prepare(
        "SELECT id FROM review_followup_summaries WHERE company_id=? AND content_hash=?",
      )
      .get(user.company_id, hash);
    let id = Number(existing?.id);
    if (!existing) {
      id = Number(
        db
          .prepare(
            "INSERT INTO review_followup_summaries(company_id,content_hash,snapshot,created_by) VALUES (?,?,?,?)",
          )
          .run(user.company_id, hash, snapshot, user.id).lastInsertRowid,
      );
      audit(user, "HR follow-up workload summary saved", String(id));
    }
    db.exec("COMMIT");
    return { id, reused: !!existing };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
