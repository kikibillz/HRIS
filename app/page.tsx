import { redirect } from "next/navigation";
import { db, snapshot } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { balances } from "@/lib/leave";
import Workspace from "./workspace";
export const dynamic = "force-dynamic";
export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/login");
  // Scope before serialization: hiding navigation cannot protect client props.
  const data = user.access === "employee"
    ? {
        employees: db.prepare(
          "SELECT e.*, d.name AS department, m.name AS manager_name FROM employees e JOIN departments d ON d.id=e.department_id LEFT JOIN reporting_lines r ON r.employee_id=e.id LEFT JOIN accounts a ON a.id=r.manager_id LEFT JOIN employees m ON m.id=a.employee_id WHERE e.id=?",
        ).all(user.employee_id),
        departments: [],
      }
    : snapshot();
  const scope = user.access === "admin" ? "" : user.access === "manager"
    ? "WHERE (l.employee_id=? OR EXISTS (SELECT 1 FROM reporting_lines r WHERE r.employee_id=l.employee_id AND r.manager_id=?))"
    : "WHERE l.employee_id=?";
  const scopeArgs = user.access === "admin" ? [] : user.access === "manager"
    ? [user.employee_id, user.id] : [user.employee_id];
  const managers = user.access === "admin" ? db.prepare(
    "SELECT a.id, a.employee_id, e.name FROM accounts a JOIN employees e ON e.id=a.employee_id WHERE a.access='manager' ORDER BY e.name",
  ).all() : [];
  const leaves = db
    .prepare(
      `SELECT l.*, e.name,e.role,COALESCE(d.reason,'Imported prototype request') AS reason FROM leaves l JOIN employees e ON e.id=l.employee_id LEFT JOIN leave_details d ON d.leave_id=l.id ${scope} ORDER BY l.id DESC`,
    )
    .all(...scopeArgs);
  const events = db
    .prepare(
      `SELECT v.*, e.name AS actor FROM leave_events v JOIN accounts a ON a.id=v.actor_id JOIN employees e ON e.id=a.employee_id JOIN leaves l ON l.id=v.leave_id ${scope} ORDER BY v.id`,
    )
    .all(...scopeArgs);
  const year = new Date().getUTCFullYear();
  return (
    <Workspace
      data={JSON.parse(
        JSON.stringify({
          ...data,
          leaves,
          events,
          user,
          managers,
          balances: [
            ...balances(user.employee_id, year),
            ...balances(user.employee_id, year + 1),
          ],
        }),
      )}
    />
  );
}
