import { randomUUID } from "node:crypto";
import { db } from "./db";
import type { User } from "./auth";
export function employeeInCompany(employeeId: number, companyId: number) {
  return !!db
    .prepare(
      "SELECT 1 FROM company_employees WHERE employee_id=? AND company_id=?",
    )
    .get(employeeId, companyId);
}
export function canManageEmployee(user: User, employeeId: number) {
  return (
    employeeInCompany(employeeId, user.company_id) &&
    (user.access === "admin" ||
      employeeId === user.employee_id ||
      (user.access === "manager" &&
        !!db
          .prepare(
            "SELECT 1 FROM reporting_lines WHERE employee_id=? AND manager_id=?",
          )
          .get(employeeId, user.id)))
  );
}
export function audit(user: User, action: string, target: string) {
  db.prepare(
    "INSERT INTO audit_log(company_id,actor_id,action,target) VALUES (?,?,?,?)",
  ).run(user.company_id, user.id, action, target);
}
export function notify(employeeId: number, title: string, body: string) {
  db.prepare(
    "INSERT INTO notifications(employee_id,title,body) VALUES (?,?,?)",
  ).run(employeeId, title, body);
}
export function department(companyId: number, name: string) {
  const found = db
    .prepare(
      "SELECT department_id FROM company_departments WHERE company_id=? AND display_name=?",
    )
    .get(companyId, name) as { department_id: number } | undefined;
  if (found) return found.department_id;
  const result = db
    .prepare("INSERT INTO departments(name) VALUES (?)")
    .run(companyId === 1 ? name : `__tenant_${companyId}_${randomUUID()}`);
  const id = Number(result.lastInsertRowid);
  db.prepare(
    "INSERT INTO company_departments(department_id,company_id,display_name) VALUES (?,?,?)",
  ).run(id, companyId, name);
  return id;
}
