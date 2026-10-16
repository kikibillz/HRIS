import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { issueAccountLink, invalidateLinks } from "@/lib/account-links";

async function manage(request: Request, revoke: boolean) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    const body = await request.json();
    if (!Number.isSafeInteger(body.employee_id) || body.employee_id < 1 ||
        (body.access !== undefined && !["employee", "manager"].includes(body.access)))
      return Response.json({ error: "Choose a valid employee and employee or manager access." }, { status: 400 });
    if (!db.prepare("SELECT id FROM employees WHERE id=?").get(body.employee_id))
      return Response.json({ error: "Employee not found." }, { status: 404 });
    db.exec("BEGIN IMMEDIATE");
    try {
      if (revoke) {
        invalidateLinks(body.employee_id);
        db.prepare("INSERT INTO security_events(employee_id,actor_id,action) VALUES (?,?,'Account links revoked')")
          .run(body.employee_id, user.id);
      }
      const link = revoke ? {} : issueAccountLink(body.employee_id, user.id, body.access ?? "employee");
      db.exec("COMMIT");
      return Response.json({ ok: true, ...link }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch {
    return Response.json({ error: "Unable to manage account links." }, { status: 400 });
  }
}
export async function POST(request: Request) { return manage(request, false); }
export async function DELETE(request: Request) { return manage(request, true); }
