import { db } from "./db";
import type { User } from "./auth";
import { validDate } from "./leave-policy";
import { audit, notify } from "./tenant";
type Item = { title: string; body: string; days: number };
// Caller holds an IMMEDIATE transaction so a whole assignment batch is atomic.
export function assignOnboarding(
  user: User,
  templateId: number,
  employeeIds: number[],
  startDate: string,
) {
  const template = db
    .prepare(
      "SELECT id,title,data FROM hr_records WHERE id=? AND company_id=? AND kind='onboarding_template' AND status='Active'",
    )
    .get(templateId, user.company_id) as
    { id: number; title: string; data: string } | undefined;
  if (!template) throw Error("Active template not found.");
  const assignmentKind = "onboarding_assignment";
  if (
    !validDate(startDate) ||
    startDate < "1900-01-01" ||
    !Array.isArray(employeeIds) ||
    !employeeIds.length ||
    employeeIds.length > 50 ||
    employeeIds.some(
      (id: unknown) => !Number.isSafeInteger(id) || Number(id) < 1,
    )
  )
    throw Error("Choose 1–50 employees and a valid start date.");
  const employees = [...new Set<number>(employeeIds)];
  const assignment_ids: number[] = [];
  for (const id of employees)
    if (
      !db
        .prepare(
          "SELECT 1 FROM employees e JOIN company_employees ce ON ce.employee_id=e.id WHERE e.id=? AND ce.company_id=? AND e.status='Active'",
        )
        .get(id, user.company_id)
    )
      throw Error(
        "An employee is unavailable in this company. No assignments were made.",
      );
  const items: Item[] = JSON.parse(template.data).items;
  const dueDates = items.map((item) => {
    const date = new Date(startDate + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + item.days);
    const value = date.toISOString().slice(0, 10);
    if (!validDate(value))
      throw Error("A task due date falls outside the supported range.");
    return value;
  });
  let created = 0,
    skipped = 0;
  for (const employee of employees) {
    const existing = db
      .prepare(
        "SELECT id FROM hr_records WHERE company_id=? AND kind=? AND reference_id=? AND employee_id=? AND due=?",
      )
      .get(
        user.company_id,
        assignmentKind,
        template.id,
        employee,
        startDate,
      ) as { id: number } | undefined;
    if (existing) {
      skipped++;
      assignment_ids.push(existing.id);
      continue;
    }
    const assignment = Number(
      db
        .prepare(
          "INSERT INTO hr_records(company_id,kind,title,employee_id,reference_id,due,created_by) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          user.company_id,
          assignmentKind,
          template.title,
          employee,
          template.id,
          startDate,
          user.id,
        ).lastInsertRowid,
    );
    for (const [index, item] of items.entries()) {
      const task = Number(
        db
          .prepare(
            "INSERT INTO hr_records(company_id,kind,title,body,employee_id,reference_id,due,data,created_by) VALUES (?,'tasks',?,?,?,?,?,?,?)",
          )
          .run(
            user.company_id,
            item.title,
            item.body,
            employee,
            assignment,
            dueDates[index],
            JSON.stringify({
              title: item.title,
              body: item.body,
              due: dueDates[index],
              employee_id: employee,
            }),
            user.id,
          ).lastInsertRowid,
      );
      db.prepare(
        "INSERT INTO hr_record_events(record_id,status,actor_id) VALUES (?,'Open',?)",
      ).run(task, user.id);
    }
    notify(
      employee,
      "Onboarding checklist assigned",
      `${template.title}: ${items.length} tasks. View Onboarding checklists for due dates.`,
    );
    audit(user, "Onboarding checklist assigned", String(assignment));
    assignment_ids.push(assignment);
    created++;
  }

  return {
    created,
    skipped,
    tasks_created: created * items.length,
    assignment_ids,
  };
}
