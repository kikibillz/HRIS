import { requireUser } from "@/lib/auth";
import { department, audit } from "@/lib/tenant";
import { db } from "@/lib/db";
export async function POST(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    const { name } = await request.json();
    if (typeof name !== "string" || !name.trim() || name.length > 100)
      return Response.json(
        { error: "Department name is required." },
        { status: 400 },
      );
    db.exec("BEGIN IMMEDIATE");
    try {
      if (
        db
          .prepare(
            "SELECT 1 FROM company_departments WHERE company_id=? AND display_name=?",
          )
          .get(user.company_id, name.trim())
      )
        throw Error("Duplicate department.");
      const id = department(user.company_id, name.trim());
      audit(user, "Department created", String(id));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return Response.json({ ok: true }, { status: 201 });
  } catch {
    return Response.json(
      { error: "Unable to add department. The name may already exist." },
      { status: 400 },
    );
  }
}
