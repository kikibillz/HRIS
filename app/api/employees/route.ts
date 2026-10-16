import { requireUser, hashPassword, validPassword } from "@/lib/auth";
import { issueAccountLink } from "@/lib/account-links";
import { employeeInCompany } from "@/lib/tenant";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    const b = await request.json();
    if (
      typeof b.name !== "string" ||
      !b.name.trim() ||
      typeof b.email !== "string" ||
      !/^\S+@\S+\.\S+$/.test(b.email) ||
      typeof b.role !== "string" ||
      !b.role.trim() ||
      !Number.isInteger(Number(b.department_id))
    )
      return Response.json(
        { error: "Enter a name, valid email, role, and department." },
        { status: 400 },
      );
    if (
      !db
        .prepare(
          "SELECT department_id FROM company_departments WHERE department_id=? AND company_id=?",
        )
        .get(Number(b.department_id), user.company_id)
    )
      return Response.json(
        { error: "Department does not exist." },
        { status: 400 },
      );
    const invite = b.setup === "invite";
    if (
      (!invite && !validPassword(b.password)) ||
      !["employee", "manager"].includes(b.access)
    )
      return Response.json(
        {
          error:
            "Choose employee or manager access and a password of 12–128 characters.",
        },
        { status: 400 },
      );
    const hash = invite ? null : hashPassword(b.password);
    let link = {};
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db
        .prepare(
          "INSERT INTO employees(name,email,role,department_id,joined) VALUES (?,?,?,?,?)",
        )
        .run(
          b.name.trim(),
          b.email.trim().toLowerCase(),
          b.role.trim(),
          Number(b.department_id),
          new Date().toISOString().slice(0, 10),
        );
      db.prepare(
        "INSERT INTO company_employees(employee_id,company_id) VALUES (?,?)",
      ).run(result.lastInsertRowid, user.company_id);
      if (invite)
        link = issueAccountLink(
          Number(result.lastInsertRowid),
          user.id,
          b.access,
        );
      else
        db.prepare(
          "INSERT INTO accounts(employee_id,email,password_hash,access) VALUES (?,?,?,?)",
        ).run(
          result.lastInsertRowid,
          b.email.trim().toLowerCase(),
          hash,
          b.access,
        );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return Response.json(
      { ok: true, ...link },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      {
        error: String(e).includes("UNIQUE")
          ? "That email is already registered."
          : "Unable to add employee.",
      },
      { status: 400 },
    );
  }
}

// Reporting lines are administrator-managed; changes apply to existing requests too.
export async function PATCH(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    const body = await request.json();
    if (
      !Number.isSafeInteger(body.employee_id) ||
      body.employee_id < 1 ||
      (body.manager_id !== null &&
        (!Number.isSafeInteger(body.manager_id) || body.manager_id < 1))
    )
      return Response.json(
        {
          error:
            "Choose an employee and a valid manager, or administrator review.",
        },
        { status: 400 },
      );
    if (!employeeInCompany(body.employee_id, user.company_id))
      return Response.json({ error: "Employee not found." }, { status: 404 });
    if (
      body.manager_id !== null &&
      !db
        .prepare(
          "SELECT a.id FROM accounts a JOIN company_employees ce ON ce.employee_id=a.employee_id WHERE a.id=? AND a.access='manager' AND a.employee_id<>? AND ce.company_id=?",
        )
        .get(body.manager_id, body.employee_id, user.company_id)
    )
      return Response.json(
        {
          error:
            "Choose a manager account other than the employee’s own account.",
        },
        { status: 400 },
      );
    db.exec("BEGIN IMMEDIATE");
    try {
      if (body.manager_id === null)
        db.prepare("DELETE FROM reporting_lines WHERE employee_id=?").run(
          body.employee_id,
        );
      else
        db.prepare(
          "INSERT INTO reporting_lines(employee_id,manager_id) VALUES (?,?) ON CONFLICT(employee_id) DO UPDATE SET manager_id=excluded.manager_id",
        ).run(body.employee_id, body.manager_id);
      db.prepare(
        "INSERT INTO reporting_events(employee_id,manager_id,actor_id) VALUES (?,?,?)",
      ).run(body.employee_id, body.manager_id, user.id);
      db.exec("COMMIT");
      return Response.json({ ok: true });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch {
    return Response.json(
      { error: "Unable to update the assigned manager." },
      { status: 400 },
    );
  }
}
