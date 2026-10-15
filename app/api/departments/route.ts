import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
export async function POST(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    const { name } = await request.json();
    if (typeof name !== "string" || !name.trim())
      return Response.json(
        { error: "Department name is required." },
        { status: 400 },
      );
    db.prepare("INSERT INTO departments(name) VALUES (?)").run(name.trim());
    return Response.json({ ok: true }, { status: 201 });
  } catch {
    return Response.json(
      { error: "Unable to add department. The name may already exist." },
      { status: 400 },
    );
  }
}
