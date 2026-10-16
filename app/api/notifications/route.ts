import { db } from "@/lib/db";
import { currentUser, requireUser } from "@/lib/auth";
import { employeeInCompany, notify, audit } from "@/lib/tenant";
export async function GET() {
  const u = await currentUser();
  if (!u) return Response.json({ error: "Please sign in." }, { status: 401 });
  return Response.json(
    {
      rows: db
        .prepare(
          "SELECT * FROM notifications WHERE employee_id=? ORDER BY id DESC LIMIT 200",
        )
        .all(u.employee_id),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function PATCH(r: Request) {
  const u = await requireUser(r);
  if (u instanceof Response) return u;
  try {
    const b = await r.json();
    db.prepare(
      "UPDATE notifications SET read_at=? WHERE id=? AND employee_id=?",
    ).run(new Date().toISOString(), Number(b.id), u.employee_id);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Invalid notification." }, { status: 400 });
  }
}
export async function POST(r: Request) {
  const u = await requireUser(r, true);
  if (u instanceof Response) return u;
  try {
    const b = await r.json();
    if (
      !Number.isSafeInteger(b.employee_id) ||
      !employeeInCompany(b.employee_id, u.company_id) ||
      typeof b.title !== "string" ||
      !b.title.trim() ||
      b.title.length > 120 ||
      typeof b.body !== "string" ||
      b.body.length > 2000
    )
      throw Error(
        "Choose an employee, title, and message up to 2,000 characters.",
      );
    notify(b.employee_id, b.title, b.body);
    audit(u, "Notification sent", String(b.employee_id));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to send." },
      { status: 400 },
    );
  }
}
