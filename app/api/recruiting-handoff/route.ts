import { currentUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { handoffPlan } from "@/lib/recruiting-handoff";
import { assignOnboarding } from "@/lib/onboarding-assignment";
import { audit } from "@/lib/tenant";
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
  const candidates = db
    .prepare(
      "SELECT a.id,a.title,json_extract(a.data,'$.email') AS email,j.title AS job FROM hr_records a JOIN hr_records j ON j.id=a.reference_id AND j.company_id=a.company_id WHERE a.company_id=? AND a.kind='applicants' AND a.status='Hired' ORDER BY a.id DESC",
    )
    .all(user.company_id);
  const employees = db
    .prepare(
      "SELECT e.id,e.name,e.email FROM employees e JOIN company_employees ce ON ce.employee_id=e.id WHERE ce.company_id=? AND e.status='Active' ORDER BY e.name",
    )
    .all(user.company_id);
  const departments = db
    .prepare(
      "SELECT department_id AS id,display_name AS name FROM company_departments WHERE company_id=? ORDER BY display_name",
    )
    .all(user.company_id);
  const templates = db
    .prepare(
      "SELECT id,title FROM hr_records WHERE company_id=? AND kind='onboarding_template' AND status='Active' ORDER BY id DESC",
    )
    .all(user.company_id);
  const handoffs = db
    .prepare(
      "SELECT h.applicant_id,h.employee_id,h.mode,h.created,h.onboarding_assignment_id,a.title,e.name FROM recruiting_handoffs h JOIN hr_records a ON a.id=h.applicant_id JOIN employees e ON e.id=h.employee_id WHERE h.company_id=? ORDER BY h.created DESC",
    )
    .all(user.company_id);
  return Response.json(
    { candidates, employees, departments, templates, handoffs },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    const b = await request.json();
    if (!["preview", "commit"].includes(b.action))
      throw Error("Choose preview or commit.");
    if (b.action === "preview") {
      const review = handoffPlan(user.company_id, b);
      return Response.json(
        {
          preview: {
            hash: review.hash,
            candidate: review.plan.candidate.title,
            mode: review.plan.mode,
            employee: review.plan.details,
            existing_employee_id: review.plan.employee?.id ?? null,
            start_date: review.plan.start_date,
            template: review.plan.template?.title ?? null,
            tasks: review.plan.tasks,
            existing_assignment_id: review.plan.existing_assignment_id,
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (
      b.confirmed !== true ||
      typeof b.preview_hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(b.preview_hash) ||
      !Number.isSafeInteger(b.applicant_id)
    )
      throw Error("Review the preview and explicitly confirm the handoff.");
    db.exec("BEGIN IMMEDIATE");
    try {
      const old = db
        .prepare(
          "SELECT employee_id,onboarding_assignment_id FROM recruiting_handoffs WHERE applicant_id=? AND company_id=?",
        )
        .get(b.applicant_id, user.company_id);
      if (old) {
        db.exec("COMMIT");
        return Response.json({ already_completed: true, ...old });
      }
      const review = handoffPlan(user.company_id, b);
      if (review.hash !== b.preview_hash)
        throw Error(
          "Handoff details changed. Generate and review a fresh preview.",
        );
      const plan = review.plan;
      let employeeId = plan.employee?.id;
      if (!employeeId) {
        employeeId = Number(
          db
            .prepare(
              "INSERT INTO employees(name,email,role,department_id,joined) VALUES (?,?,?,?,?)",
            )
            .run(
              plan.details.name,
              plan.details.email,
              plan.details.role,
              plan.details.department_id,
              plan.details.joined,
            ).lastInsertRowid,
        );
        db.prepare(
          "INSERT INTO company_employees(employee_id,company_id) VALUES (?,?)",
        ).run(employeeId, user.company_id);
      }
      const assignment = plan.template
        ? assignOnboarding(
            user,
            plan.template.id,
            [employeeId],
            plan.start_date,
          ).assignment_ids[0]
        : null;
      db.prepare(
        "INSERT INTO recruiting_handoffs(applicant_id,company_id,employee_id,approval_id,onboarding_assignment_id,mode,snapshot,snapshot_hash,created_by) VALUES (?,?,?,?,?,?,?,?,?)",
      ).run(
        plan.candidate.id,
        user.company_id,
        employeeId,
        plan.approval.id,
        assignment ?? null,
        plan.mode,
        review.snapshot,
        review.hash,
        user.id,
      );
      audit(
        user,
        "Candidate handoff completed",
        `${plan.candidate.id}:${employeeId}`,
      );
      db.exec("COMMIT");
      return Response.json(
        {
          already_completed: false,
          employee_id: employeeId,
          onboarding_assignment_id: assignment ?? null,
        },
        { status: 201 },
      );
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to complete handoff." },
      { status: 400 },
    );
  }
}
