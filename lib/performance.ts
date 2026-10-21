import { db } from "./db";
import type { User } from "./auth";
import { audit, employeeInCompany, notify } from "./tenant";
import { validDate } from "./leave-policy";

type Cycle = {
  id: number;
  title: string;
  start: string;
  due: string;
  status: string;
};
export function performanceCycles(user: User) {
  if (user.access !== "admin") throw Error("Administrator access required.");
  return db
    .prepare(
      `SELECT c.*,COUNT(a.record_id) AS assigned,
    SUM(CASE WHEN r.status='Submitted' THEN 1 ELSE 0 END) AS submitted,
    SUM(CASE WHEN r.status='Published' THEN 1 ELSE 0 END) AS published
    FROM performance_cycles c LEFT JOIN performance_assignments a ON a.cycle_id=c.id
    LEFT JOIN hr_records r ON r.id=a.record_id WHERE c.company_id=? GROUP BY c.id ORDER BY c.id DESC`,
    )
    .all(user.company_id);
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
