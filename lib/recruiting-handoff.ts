import { createHash } from "node:crypto";
import { db } from "./db";
import { validDate } from "./leave-policy";
export function handoffPlan(company: number, b: Record<string, unknown>) {
  if (
    !Number.isSafeInteger(b.applicant_id) ||
    !["create", "link"].includes(String(b.mode)) ||
    !validDate(b.start_date) ||
    b.start_date < "1900-01-01"
  )
    throw Error("Choose a hired candidate, handoff mode and valid start date.");
  const candidate = db
    .prepare(
      "SELECT a.id,a.title,a.body,a.data,a.reference_id,j.title AS job,j.body AS job_details FROM hr_records a JOIN hr_records j ON j.id=a.reference_id AND j.company_id=a.company_id AND j.kind='jobs' WHERE a.id=? AND a.company_id=? AND a.kind='applicants' AND a.status='Hired'",
    )
    .get(Number(b.applicant_id), company) as
    | {
        id: number;
        title: string;
        body: string;
        data: string;
        reference_id: number;
        job: string;
        job_details: string;
      }
    | undefined;
  if (!candidate) throw Error("Hired candidate not found in this company.");
  const approval = db
    .prepare(
      "SELECT id,status,snapshot_hash,decided FROM recruiting_approvals WHERE applicant_id=? AND company_id=? ORDER BY id DESC LIMIT 1",
    )
    .get(candidate.id, company) as
    | { id: number; status: string; snapshot_hash: string; decided: string }
    | undefined;
  if (approval?.status !== "Approved")
    throw Error(
      "This handoff requires a recorded hiring approval. Legacy hires can still use the existing employee/import workflow.",
    );
  type Employee = {
    id: number;
    name: string;
    email: string;
    role: string;
    joined: string;
    department_id: number;
    status: string;
  };
  type Template = { id: number; title: string; data: string };
  let employee: Employee | null = null;
  let details: {
    name: string;
    email: string;
    role: string;
    department_id: number;
    department: string;
    joined: string;
  };
  if (b.mode === "link") {
    if (!Number.isSafeInteger(b.employee_id))
      throw Error("Choose an existing employee from this company.");
    employee =
      (db
        .prepare(
          "SELECT e.id,e.name,e.email,e.role,e.joined,e.department_id,e.status FROM employees e JOIN company_employees ce ON ce.employee_id=e.id WHERE e.id=? AND ce.company_id=? AND e.status='Active'",
        )
        .get(Number(b.employee_id), company) as Employee | undefined) || null;
    if (!employee) throw Error("Active employee not found in this company.");
    const dept = db
      .prepare(
        "SELECT display_name FROM company_departments WHERE department_id=? AND company_id=?",
      )
      .get(employee.department_id, company) as
      { display_name: string } | undefined;
    if (!dept) throw Error("Employee department not found.");
    details = {
      name: employee.name,
      email: employee.email,
      role: employee.role,
      department_id: employee.department_id,
      department: dept.display_name,
      joined: employee.joined,
    };
  } else {
    if (
      typeof b.work_email !== "string" ||
      !/^\S+@\S+\.\S+$/.test(b.work_email) ||
      b.work_email.length > 254 ||
      typeof b.role !== "string" ||
      !b.role.trim() ||
      b.role.length > 120 ||
      !Number.isSafeInteger(b.department_id) ||
      candidate.title.length > 120
    )
      throw Error(
        "Provide a valid work email, job title (up to 120 characters), and department. Candidate names must fit the employee record.",
      );
    const email = b.work_email.trim().toLowerCase();
    if (
      db
        .prepare(
          "SELECT 1 FROM employees WHERE lower(email)=? UNION ALL SELECT 1 FROM accounts WHERE lower(email)=? LIMIT 1",
        )
        .get(email, email)
    )
      throw Error(
        "This email is already in use. Explicitly link a company employee or choose a unique work email.",
      );
    const dept = db
      .prepare(
        "SELECT display_name FROM company_departments WHERE department_id=? AND company_id=?",
      )
      .get(Number(b.department_id), company) as
      { display_name: string } | undefined;
    if (!dept) throw Error("Choose a department from this company.");
    details = {
      name: candidate.title,
      email,
      role: b.role.trim(),
      department_id: Number(b.department_id),
      department: dept.display_name,
      joined: b.start_date,
    };
  }
  let template: Template | null = null;
  if (b.template_id !== null && b.template_id !== undefined) {
    if (!Number.isSafeInteger(b.template_id))
      throw Error("Choose a valid onboarding template.");
    template =
      (db
        .prepare(
          "SELECT id,title,data FROM hr_records WHERE id=? AND company_id=? AND kind='onboarding_template' AND status='Active'",
        )
        .get(Number(b.template_id), company) as Template | undefined) || null;
    if (!template)
      throw Error("Active onboarding template not found in this company.");
  }
  const existingAssignment =
    employee && template
      ? (db
          .prepare(
            "SELECT id FROM hr_records WHERE company_id=? AND kind='onboarding_assignment' AND employee_id=? AND reference_id=? AND due=?",
          )
          .get(company, employee.id, template.id, b.start_date) as
          { id: number } | undefined)
      : undefined;
  const tasks = template
    ? (
        JSON.parse(template.data).items as {
          title: string;
          body: string;
          days: number;
        }[]
      ).map((item) => {
        const d = new Date(b.start_date + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + item.days);
        const due = d.toISOString().slice(0, 10);
        if (!validDate(due))
          throw Error("A task due date is outside the supported range.");
        return { ...item, due };
      })
    : [];
  const reviewedTasks = existingAssignment
    ? db
        .prepare(
          "SELECT title,body,due,status FROM hr_records WHERE company_id=? AND kind='tasks' AND employee_id=? AND reference_id=? ORDER BY id",
        )
        .all(company, employee!.id, existingAssignment.id)
    : tasks;
  const plan = {
    candidate,
    approval,
    mode: b.mode === "link" ? "link" : "create",
    employee,
    details,
    start_date: b.start_date,
    template,
    tasks: reviewedTasks,
    existing_assignment_id: existingAssignment?.id ?? null,
  };
  const snapshot = JSON.stringify(plan);
  return {
    plan,
    snapshot,
    hash: createHash("sha256").update(snapshot).digest("hex"),
  };
}
