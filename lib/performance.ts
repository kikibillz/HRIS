import { createHash } from "node:crypto";
import { db } from "./db";
import type { User } from "./auth";
import { audit, employeeInCompany, notify } from "./tenant";
import { validDate } from "./leave-policy";
import { onboardingDay } from "./onboarding-date";

function revision(record: Record<string, unknown>) {
  const event = db
    .prepare(
      "SELECT MAX(id) AS id FROM performance_reassignments WHERE record_id=?",
    )
    .get(Number(record.id));
  return createHash("sha256")
    .update(
      JSON.stringify([
        record.id,
        record.reviewer_id,
        record.title,
        record.body,
        record.status,
        record.due,
        record.data,
        record.progress,
        event?.id,
      ]),
    )
    .digest("hex");
}

type Cycle = {
  id: number;
  title: string;
  start: string;
  due: string;
  status: string;
};
export function performanceCycles(user: User) {
  if (user.access !== "admin") throw Error("Administrator access required.");
  const day = onboardingDay();
  const cycles = db
    .prepare(
      `SELECT c.*,COUNT(a.record_id) AS assigned,
    SUM(CASE WHEN r.status='Submitted' THEN 1 ELSE 0 END) AS submitted,
    SUM(CASE WHEN r.status='Published' THEN 1 ELSE 0 END) AS published,
    SUM(CASE WHEN r.status='Published' AND ack.record_id IS NOT NULL THEN 1 ELSE 0 END) AS acknowledged,
    SUM(CASE WHEN r.status='Published' AND ack.record_id IS NULL THEN 1 ELSE 0 END) AS awaiting_acknowledgment,
    SUM(CASE WHEN r.status='Draft' THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN c.status='Open' AND r.status='Draft' AND r.due<>'' AND r.due<? THEN 1 ELSE 0 END) AS overdue
    FROM performance_cycles c LEFT JOIN performance_assignments a ON a.cycle_id=c.id
    LEFT JOIN hr_records r ON r.id=a.record_id LEFT JOIN review_acknowledgments ack ON ack.record_id=r.id AND ack.company_id=c.company_id WHERE c.company_id=? GROUP BY c.id ORDER BY c.id DESC`,
    )
    .all(day, user.company_id);
  return cycles.map((cycle) => ({
    ...cycle,
    assignments: db
      .prepare(
        `SELECT ack.created AS acknowledged_at,r.id,r.employee_id,r.reviewer_id,r.title,r.body,r.data,r.progress,r.status,r.due,e.name AS employee_name,v.name AS reviewer_name,
    CASE WHEN r.status='Draft' AND r.due<>'' AND r.due<? AND c.status='Open' THEN 1 ELSE 0 END AS overdue,
    (SELECT MAX(day) FROM performance_reminders pr WHERE pr.record_id=r.id) AS last_reminded
    FROM performance_assignments a JOIN performance_cycles c ON c.id=a.cycle_id
    JOIN hr_records r ON r.id=a.record_id JOIN employees e ON e.id=r.employee_id
    JOIN employees v ON v.id=r.reviewer_id LEFT JOIN review_acknowledgments ack ON ack.record_id=r.id AND ack.company_id=c.company_id WHERE a.cycle_id=? AND c.company_id=? ORDER BY e.name,r.id`,
      )
      .all(day, Number(cycle.id), user.company_id)
      .map((record) => {
        const { body, data, progress, title, ...metadata } = record;
        return {
          ...metadata,
          revision: revision(record),
          history: db
            .prepare(
              `SELECT h.id,h.reason,h.created,h.snapshot,f.name AS from_name,t.name AS to_name,e.name AS actor_name FROM performance_reassignments h JOIN employees f ON f.id=h.from_reviewer_id JOIN employees t ON t.id=h.to_reviewer_id JOIN accounts ac ON ac.id=h.actor_id JOIN employees e ON e.id=ac.employee_id WHERE h.record_id=? AND h.company_id=? ORDER BY h.id DESC`,
            )
            .all(Number(record.id), user.company_id),
        };
      }),
  }));
}
export function changePerformance(user: User, b: Record<string, unknown>) {
  if (user.access !== "admin") throw Error("Administrator access required.");
  db.exec("BEGIN IMMEDIATE");
  try {
    let result: Record<string, unknown>;
    if (b.action === "create") {
      const title = String(b.title ?? "").trim(),
        start = String(b.start ?? ""),
        due = String(b.due ?? "");
      if (!title || title.length > 500)
        throw Error("Enter a cycle title of up to 500 characters.");
      if (!validDate(start) || !validDate(due) || start > due)
        throw Error(
          "Enter valid cycle dates with the due date on or after the start.",
        );
      const id = Number(
        db
          .prepare(
            "INSERT INTO performance_cycles(company_id,title,start,due,created_by) VALUES (?,?,?,?,?)",
          )
          .run(user.company_id, title, start, due, user.id).lastInsertRowid,
      );
      audit(user, "Performance cycle created", String(id));
      result = { id };
    } else {
      if (!Number.isSafeInteger(b.cycle_id) || Number(b.cycle_id) < 1)
        throw Error("Invalid cycle ID.");
      const cycle = db
        .prepare("SELECT * FROM performance_cycles WHERE id=? AND company_id=?")
        .get(Number(b.cycle_id), user.company_id) as Cycle | undefined;
      if (!cycle) throw Error("Cycle not found.");
      if (cycle.status !== "Open") throw Error("This cycle is closed.");
      if (b.action === "assign") {
        if (
          !Array.isArray(b.employee_ids) ||
          !b.employee_ids.length ||
          b.employee_ids.length > 200
        )
          throw Error("Choose between 1 and 200 employees.");
        const ids = [...new Set(b.employee_ids)];
        const reviewer = Number(b.reviewer_id);
        if (
          !Number.isSafeInteger(b.reviewer_id) ||
          !employeeInCompany(reviewer, user.company_id)
        )
          throw Error("Choose a reviewer from this company.");
        const active = (id: number) =>
          !!db
            .prepare("SELECT 1 FROM employees WHERE id=? AND status='Active'")
            .get(id);
        if (!active(reviewer)) throw Error("Choose an active reviewer.");
        // Validate the entire batch before writing or notifying anyone.
        for (const id of ids) {
          if (
            !Number.isSafeInteger(id) ||
            !employeeInCompany(Number(id), user.company_id)
          )
            throw Error("Employee not found.");
          if (!active(Number(id))) throw Error("Choose active employees.");
          if (id === reviewer)
            throw Error("Reviewers cannot review themselves.");
        }
        let assigned = 0,
          skipped = 0;
        for (const id of ids) {
          if (
            db
              .prepare(
                "SELECT 1 FROM performance_assignments WHERE cycle_id=? AND employee_id=?",
              )
              .get(cycle.id, Number(id))
          ) {
            skipped++;
            continue;
          }
          const data = {
            title: cycle.title,
            employee_id: id,
            reviewer_id: reviewer,
            body: "",
            due: cycle.due,
          };
          const record = Number(
            db
              .prepare(
                "INSERT INTO hr_records(company_id,kind,employee_id,reviewer_id,title,body,status,progress,due,data,created_by) VALUES (?,'reviews',?,?,?,'','Draft',0,?,?,?)",
              )
              .run(
                user.company_id,
                Number(id),
                reviewer,
                cycle.title,
                cycle.due,
                JSON.stringify(data),
                user.id,
              ).lastInsertRowid,
          );
          db.prepare(
            "INSERT INTO performance_assignments(cycle_id,employee_id,record_id) VALUES (?,?,?)",
          ).run(cycle.id, Number(id), record);
          db.prepare(
            "INSERT INTO hr_record_events(record_id,status,actor_id) VALUES (?,'Draft',?)",
          ).run(record, user.id);
          audit(user, "Cycle review assigned", String(record));
          notify(reviewer, "Review requested", cycle.title);
          assigned++;
        }
        result = { assigned, skipped };
      } else if (b.action === "reassign") {
        if (
          !Number.isSafeInteger(b.record_id) ||
          !Number.isSafeInteger(b.reviewer_id)
        )
          throw Error("Choose a review and replacement reviewer.");
        const record = db
          .prepare(
            `SELECT r.* FROM hr_records r JOIN performance_assignments a ON a.record_id=r.id WHERE r.id=? AND a.cycle_id=? AND r.company_id=? AND r.kind='reviews'`,
          )
          .get(Number(b.record_id), cycle.id, user.company_id);
        if (!record) throw Error("Review not found in this cycle.");
        if (record.status === "Published")
          throw Error("Published reviews cannot be reassigned.");
        if (typeof b.revision !== "string" || b.revision !== revision(record))
          throw Error(
            "The review changed. Refresh progress and review it again.",
          );
        const reason = typeof b.reason === "string" ? b.reason.trim() : "";
        if (!reason || reason.length > 2000)
          throw Error(
            "Provide a reassignment reason of up to 2000 characters.",
          );
        const reviewer = Number(b.reviewer_id);
        if (reviewer === record.reviewer_id || reviewer === record.employee_id)
          throw Error(
            "Choose a different reviewer who is not the employee being reviewed.",
          );
        if (
          !employeeInCompany(reviewer, user.company_id) ||
          !db
            .prepare(
              "SELECT 1 FROM employees e JOIN accounts ac ON ac.employee_id=e.id WHERE e.id=? AND e.status='Active'",
            )
            .get(reviewer)
        )
          throw Error(
            "Choose an active reviewer with an account in this company.",
          );
        db.prepare(
          "INSERT INTO performance_reassignments(company_id,record_id,from_reviewer_id,to_reviewer_id,actor_id,reason,snapshot) VALUES (?,?,?,?,?,?,?)",
        ).run(
          user.company_id,
          Number(record.id),
          Number(record.reviewer_id),
          reviewer,
          user.id,
          reason,
          JSON.stringify(record),
        );
        const data = JSON.parse(String(record.data));
        data.reviewer_id = reviewer;
        db.prepare("UPDATE hr_records SET reviewer_id=?,data=? WHERE id=?").run(
          reviewer,
          JSON.stringify(data),
          Number(record.id),
        );
        audit(user, "Performance review reassigned", String(record.id));
        notify(
          reviewer,
          "Review reassigned to you",
          `${record.title} · Review #${record.id}. Existing response and status are preserved.`,
        );
        result = { reassigned: true, id: Number(record.id) };
      } else if (b.action === "remind") {
        const day = onboardingDay();
        if (cycle.start > day)
          throw Error("Reminders are available once the cycle starts.");
        const rows = db
          .prepare(
            `SELECT r.id,r.reviewer_id,r.title,r.due FROM performance_assignments a
          JOIN hr_records r ON r.id=a.record_id JOIN employees e ON e.id=r.employee_id
          JOIN employees v ON v.id=r.reviewer_id
          WHERE a.cycle_id=? AND r.company_id=? AND r.status='Draft'
          AND e.status='Active' AND v.status='Active'
          AND EXISTS(SELECT 1 FROM company_employees ce WHERE ce.employee_id=v.id AND ce.company_id=r.company_id)
          AND EXISTS(SELECT 1 FROM accounts ac WHERE ac.employee_id=v.id)`,
          )
          .all(cycle.id, user.company_id);
        let sent = 0,
          skipped = 0;
        for (const row of rows) {
          if (
            db
              .prepare(
                "SELECT 1 FROM performance_reminders WHERE record_id=? AND day=?",
              )
              .get(Number(row.id), day)
          ) {
            skipped++;
            continue;
          }
          const notification = db
            .prepare(
              "INSERT INTO notifications(employee_id,title,body) VALUES (?,?,?)",
            )
            .run(
              Number(row.reviewer_id),
              "Performance review reminder",
              `${row.title} · Review #${row.id}${row.due ? ` · Due ${row.due}` : ""}. Open Performance reviews to complete your assigned response.`,
            );
          db.prepare(
            "INSERT INTO performance_reminders(record_id,day,company_id,reviewer_id,actor_id,notification_id) VALUES (?,?,?,?,?,?)",
          ).run(
            Number(row.id),
            day,
            user.company_id,
            Number(row.reviewer_id),
            user.id,
            Number(notification.lastInsertRowid),
          );
          audit(user, "Performance review reminder sent", String(row.id));
          sent++;
        }
        result = { sent, skipped };
      } else if (b.action === "close") {
        if (
          db
            .prepare(
              "SELECT 1 FROM performance_assignments a JOIN hr_records r ON r.id=a.record_id WHERE a.cycle_id=? AND r.status<>'Published'",
            )
            .get(cycle.id)
        )
          throw Error("Publish all assigned reviews before closing the cycle.");
        db.prepare(
          "UPDATE performance_cycles SET status='Closed' WHERE id=?",
        ).run(cycle.id);
        audit(user, "Performance cycle closed", String(cycle.id));
        result = { id: cycle.id };
      } else throw Error("Unknown cycle action.");
    }
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
