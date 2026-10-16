import { db } from "@/lib/db";
import { currentUser, requireUser } from "@/lib/auth";
import { employeeInCompany, audit, notify } from "@/lib/tenant";
export async function GET() {
  const u = await currentUser();
  if (!u) return Response.json({ error: "Please sign in." }, { status: 401 });
  return Response.json(
    {
      rows: db
        .prepare(
          `SELECT id,name,mime,employee_id,created,length(bytes) AS size FROM documents WHERE company_id=? ${u.access === "admin" ? "" : "AND (employee_id=? OR employee_id IS NULL)"} ORDER BY id DESC`,
        )
        .all(
          ...(u.access === "admin"
            ? [u.company_id]
            : [u.company_id, u.employee_id]),
        ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const u = await requireUser(request);
  if (u instanceof Response) return u;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024)
      throw Error("Choose a non-empty file up to 5 MB.");
    const allowed = [
      "application/pdf",
      "text/plain",
      "image/png",
      "image/jpeg",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!allowed.includes(file.type))
      throw Error("Use PDF, TXT, PNG, JPEG, or DOCX.");
    const target =
      u.access === "admin"
        ? form.get("employee_id")
          ? Number(form.get("employee_id"))
          : null
        : u.employee_id;
    if (target !== null && !employeeInCompany(target, u.company_id))
      throw Error("Employee not found.");
    const bytes = Buffer.from(await file.arrayBuffer());
    db.exec("BEGIN IMMEDIATE");
    try {
      const used = db
        .prepare(
          "SELECT COALESCE(SUM(length(bytes)),0) AS total FROM documents WHERE company_id=?",
        )
        .get(u.company_id) as { total: number };
      if (used.total + bytes.length > 50 * 1024 * 1024)
        throw Error("This company’s 50 MB document limit has been reached.");
      const result = db
        .prepare(
          "INSERT INTO documents(company_id,employee_id,name,mime,bytes,uploaded_by) VALUES (?,?,?,?,?,?)",
        )
        .run(
          u.company_id,
          target,
          file.name.replace(/[\r\n]/g, "").slice(0, 200),
          file.type,
          bytes,
          u.id,
        );
      audit(u, "Document uploaded", String(result.lastInsertRowid));
      if (target && target !== u.employee_id)
        notify(target, "Document available", file.name.slice(0, 200));
      db.exec("COMMIT");
      return Response.json({ ok: true }, { status: 201 });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Upload failed." },
      { status: 400 },
    );
  }
}
