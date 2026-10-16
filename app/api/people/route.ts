import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { employeeInCompany, audit } from "@/lib/tenant";
import { validDate } from "@/lib/leave-policy";
export async function PATCH(r: Request) {
  const u = await requireUser(r, true);
  if (u instanceof Response) return u;
  try {
    const b = await r.json();
    if (
      !Number.isSafeInteger(b.employee_id) ||
      !employeeInCompany(b.employee_id, u.company_id)
    )
      throw Error("Employee not found.");
    if (
      typeof b.name !== "string" ||
      !b.name.trim() ||
      b.name.length > 120 ||
      typeof b.role !== "string" ||
      !b.role.trim() ||
      b.role.length > 120 ||
      !validDate(b.joined) ||
      !["Active", "Inactive"].includes(b.status)
    )
      throw Error(
        "Enter a name, job title, joined date, and Active or Inactive status.",
      );
    const account = db
      .prepare("SELECT id,access FROM accounts WHERE employee_id=?")
      .get(b.employee_id) as { id: number; access: string } | undefined;
    if (b.employee_id === u.employee_id && b.status !== "Active")
      throw Error("You cannot deactivate your own account.");
    if (account?.access === "admin" && b.status === "Inactive")
      throw Error(
        "Administrator deactivation requires an ownership-transfer workflow.",
      );
    if (
      b.access !== undefined &&
      (!["employee", "manager"].includes(b.access) ||
        account?.access === "admin")
    )
      throw Error("Only employee and manager roles can be changed here.");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "UPDATE employees SET name=?,role=?,joined=?,status=? WHERE id=?",
      ).run(b.name.trim(), b.role.trim(), b.joined, b.status, b.employee_id);
      if (account) {
        if (b.status === "Inactive")
          db.prepare("DELETE FROM reporting_lines WHERE manager_id=?").run(
            account.id,
          );
        if (b.access) {
          db.prepare("UPDATE accounts SET access=? WHERE id=?").run(
            b.access,
            account.id,
          );
          if (b.access !== "manager")
            db.prepare("DELETE FROM reporting_lines WHERE manager_id=?").run(
              account.id,
            );
        }
        db.prepare("DELETE FROM sessions WHERE account_id=?").run(account.id);
        db.prepare(
          "UPDATE account_links SET used_at=? WHERE employee_id=? AND used_at IS NULL",
        ).run(Date.now(), b.employee_id);
      }
      audit(u, "Employee record updated", String(b.employee_id));
      db.exec("COMMIT");
      return Response.json({ ok: true });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to update employee." },
      { status: 400 },
    );
  }
}
