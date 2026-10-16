import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
export async function GET() {
  const u = await currentUser();
  if (!u) return Response.json({ error: "Please sign in." }, { status: 401 });
  const c = db.prepare("SELECT * FROM companies WHERE id=?").get(u.company_id);
  const employees = db
    .prepare(
      `SELECT e.id,e.name,e.email,e.role,e.joined,e.status,a.access AS account_access,cd.display_name AS department FROM employees e JOIN company_employees ce ON ce.employee_id=e.id LEFT JOIN accounts a ON a.employee_id=e.id JOIN company_departments cd ON cd.department_id=e.department_id WHERE ce.company_id=? ${u.access === "employee" ? "AND e.id=?" : ""} ORDER BY e.name`,
    )
    .all(
      ...(u.access === "employee"
        ? [u.company_id, u.employee_id]
        : [u.company_id]),
    );
  const peers = db
    .prepare(
      "SELECT e.id,e.name FROM employees e JOIN company_employees ce ON ce.employee_id=e.id WHERE ce.company_id=? AND e.status='Active' ORDER BY e.name",
    )
    .all(u.company_id);
  const managed = db
    .prepare("SELECT employee_id FROM reporting_lines WHERE manager_id=?")
    .all(u.id);
  return Response.json(
    {
      user: u,
      company: c,
      employees,
      peers,
      managed,
      ai_configured:
        !!process.env.AI_GATEWAY_API_KEY &&
        !!process.env.AI_GATEWAY_MODEL &&
        String(process.env.AI_ENABLED_COMPANY_IDS ?? "")
          .split(",")
          .map((id) => id.trim())
          .includes(String(u.company_id)),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
