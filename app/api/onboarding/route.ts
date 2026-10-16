import { currentUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { validDate } from "@/lib/leave-policy";
import { audit, notify } from "@/lib/tenant";
type Item = { title: string; body: string; days: number };
type Template = { id: number; title: string; data: string; status: string };
const kind = "onboarding_template",
  assignmentKind = "onboarding_assignment";
export const dynamic = "force-dynamic";
export async function GET() {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  if (user.access !== "admin")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  const templates = (
    db
      .prepare(
        "SELECT id,title,data,status FROM hr_records WHERE company_id=? AND kind=? ORDER BY id DESC",
      )
      .all(user.company_id, kind) as Template[]
  ).map((t) => ({ ...t, items: JSON.parse(t.data).items, data: undefined }));
  const assignments = db
    .prepare(
      "SELECT a.id,a.title,a.due AS start_date,e.name,COUNT(t.id) AS total,SUM(CASE WHEN t.status='Done' THEN 1 ELSE 0 END) AS completed FROM hr_records a JOIN employees e ON e.id=a.employee_id LEFT JOIN hr_records t ON t.reference_id=a.id AND t.kind='tasks' AND t.company_id=a.company_id AND t.employee_id=a.employee_id WHERE a.company_id=? AND a.kind=? GROUP BY a.id ORDER BY a.id DESC LIMIT 100",
    )
    .all(user.company_id, assignmentKind);
  return Response.json(
    { templates, assignments },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    const b = await request.json();
    if (b.action === "create") {
      if (
        typeof b.title !== "string" ||
        !b.title.trim() ||
        b.title.trim().length > 200 ||
        !Array.isArray(b.items) ||
        !b.items.length ||
        b.items.length > 20
      )
        throw Error("Provide a template name and 1–20 tasks.");
      const items: Item[] = b.items.map((i: Item) => {
        if (
          !i ||
          typeof i.title !== "string" ||
          !i.title.trim() ||
          i.title.trim().length > 200 ||
          typeof i.body !== "string" ||
          i.body.length > 2000 ||
          !Number.isInteger(i.days) ||
          i.days < -30 ||
          i.days > 365
        )
          throw Error(
            "Each task needs a title, details up to 2,000 characters, and an offset from −30 to 365 calendar days.",
          );
        return { title: i.title.trim(), body: i.body.trim(), days: i.days };
      });
      db.exec("BEGIN IMMEDIATE");
      try {
        const id = Number(
          db
            .prepare(
              "INSERT INTO hr_records(company_id,kind,title,status,data,created_by) VALUES (?,?,?,'Active',?,?)",
            )
            .run(
              user.company_id,
              kind,
              b.title.trim(),
              JSON.stringify({ items }),
              user.id,
            ).lastInsertRowid,
        );
        audit(user, "Onboarding template created", String(id));
        db.exec("COMMIT");
        return Response.json({ id }, { status: 201 });
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
    if (
      !["archive", "assign"].includes(b.action) ||
      !Number.isSafeInteger(b.template_id) ||
      b.template_id < 1
    )
      throw Error("Choose a valid template and action.");
    // Synchronous validation and writes share one transaction, including retry checks.
    db.exec("BEGIN IMMEDIATE");
    try {
      const template = db
        .prepare(
          "SELECT id,title,status,data FROM hr_records WHERE id=? AND company_id=? AND kind=?",
        )
        .get(b.template_id, user.company_id, kind) as Template | undefined;
      if (!template || template.status !== "Active")
        throw Error("Active template not found.");
      if (b.action === "archive") {
        db.prepare("UPDATE hr_records SET status='Archived' WHERE id=?").run(
          template.id,
        );
        audit(user, "Onboarding template archived", String(template.id));
        db.exec("COMMIT");
        return Response.json({ ok: true });
      }
      if (
        !validDate(b.start_date) ||
        b.start_date < "1900-01-01" ||
        !Array.isArray(b.employee_ids) ||
        !b.employee_ids.length ||
        b.employee_ids.length > 50 ||
        b.employee_ids.some(
          (id: unknown) => !Number.isSafeInteger(id) || Number(id) < 1,
        )
      )
        throw Error("Choose 1–50 employees and a valid start date.");
      const employees = [...new Set<number>(b.employee_ids)];
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
        const date = new Date(b.start_date + "T00:00:00Z");
        date.setUTCDate(date.getUTCDate() + item.days);
        const value = date.toISOString().slice(0, 10);
        if (!validDate(value))
          throw Error("A task due date falls outside the supported range.");
        return value;
      });
      let created = 0,
        skipped = 0;
      for (const employee of employees) {
        if (
          db
            .prepare(
              "SELECT id FROM hr_records WHERE company_id=? AND kind=? AND reference_id=? AND employee_id=? AND due=?",
            )
            .get(
              user.company_id,
              assignmentKind,
              template.id,
              employee,
              b.start_date,
            )
        ) {
          skipped++;
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
              b.start_date,
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
        created++;
      }
      db.exec("COMMIT");
      return Response.json({
        created,
        skipped,
        tasks_created: created * items.length,
      });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to save onboarding." },
      { status: 400 },
    );
  }
}
