import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { balances } from "@/lib/leave";
import Workspace from "./workspace";
export const dynamic = "force-dynamic";
export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/login");
  // Derive every read scope from the authenticated session, never client input.
  const personal = user.access === "employee";
  const employees = db.prepare(
    `SELECT e.id,e.name,e.email,e.role,e.department_id,e.joined,e.status,d.name AS department
     FROM employees e JOIN departments d ON d.id=e.department_id
     ${personal ? "WHERE e.id=?" : ""} ORDER BY e.id DESC`,
  ).all(...(personal ? [user.employee_id] : []));
  const departments = personal ? [] : db.prepare(
    "SELECT d.id,d.name,COUNT(e.id) AS count FROM departments d LEFT JOIN employees e ON e.department_id=d.id GROUP BY d.id",
  ).all();
  const leaves = db
    .prepare(
      `SELECT l.*, e.name,e.role,COALESCE(d.reason,'Imported prototype request') AS reason FROM leaves l JOIN employees e ON e.id=l.employee_id LEFT JOIN leave_details d ON d.leave_id=l.id ${user.access === "employee" ? "WHERE l.employee_id=?" : ""} ORDER BY l.id DESC`,
    )
    .all(...(user.access === "employee" ? [user.employee_id] : []));
  const events = db
    .prepare(
      `SELECT v.*, e.name AS actor FROM leave_events v JOIN accounts a ON a.id=v.actor_id JOIN employees e ON e.id=a.employee_id JOIN leaves l ON l.id=v.leave_id ${user.access === "employee" ? "WHERE l.employee_id=?" : ""} ORDER BY v.id`,
    )
    .all(...(user.access === "employee" ? [user.employee_id] : []));
  const year = new Date().getUTCFullYear();
  return (
    <Workspace
      data={JSON.parse(
        JSON.stringify({
          employees,
          departments,
          leaves,
          events,
          user,
          balances: [
            ...balances(user.employee_id, year),
            ...balances(user.employee_id, year + 1),
          ],
        }),
      )}
    />
  );
}

