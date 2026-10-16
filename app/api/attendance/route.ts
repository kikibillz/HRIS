import { db } from "@/lib/db";
import { currentUser, requireUser } from "@/lib/auth";
import { audit } from "@/lib/tenant";
export async function GET() {
  const u = await currentUser();
  if (!u) return Response.json({ error: "Please sign in." }, { status: 401 });
  const scope =
    u.access === "admin"
      ? ""
      : u.access === "manager"
        ? "AND (a.employee_id=? OR EXISTS(SELECT 1 FROM reporting_lines r WHERE r.employee_id=a.employee_id AND r.manager_id=?))"
        : "AND a.employee_id=?";
  const args =
    u.access === "admin"
      ? [u.company_id]
      : u.access === "manager"
        ? [u.company_id, u.employee_id, u.id]
        : [u.company_id, u.employee_id];
  return Response.json(
    {
      rows: db
        .prepare(
          `SELECT a.*,e.name FROM attendance a JOIN employees e ON e.id=a.employee_id JOIN company_employees ce ON ce.employee_id=e.id WHERE ce.company_id=? ${scope} ORDER BY a.id DESC LIMIT 500`,
        )
        .all(...args),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const u = await requireUser(request);
  if (u instanceof Response) return u;
  try {
    const b = await request.json();
    if (
      !["in", "out"].includes(b.action) ||
      typeof (b.note ?? "") !== "string" ||
      String(b.note ?? "").length > 500
    )
      throw Error(
        "Choose clock in or clock out and a note up to 500 characters.",
      );
    db.exec("BEGIN IMMEDIATE");
    try {
      const now = new Date().toISOString();
      if (b.action === "in")
        db.prepare(
          "INSERT INTO attendance(employee_id,clock_in,note) VALUES (?,?,?)",
        ).run(u.employee_id, now, b.note ?? "");
      else {
        const result = db
          .prepare(
            "UPDATE attendance SET clock_out=? WHERE employee_id=? AND clock_out IS NULL",
          )
          .run(now, u.employee_id);
        if (!result.changes) throw Error("You are not clocked in.");
      }
      audit(u, `Clocked ${b.action}`, String(u.employee_id));
      db.exec("COMMIT");
      return Response.json({ ok: true });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch (e) {
    return Response.json(
      {
        error: String(e).includes("UNIQUE")
          ? "You are already clocked in."
          : e instanceof Error
            ? e.message
            : "Unable to clock in.",
      },
      { status: 409 },
    );
  }
}
