import { db } from "@/lib/db";
import { currentUser, requireUser } from "@/lib/auth";
import { audit } from "@/lib/tenant";
export async function GET(
  _r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const u = await currentUser();
  if (!u) return Response.json({ error: "Please sign in." }, { status: 401 });
  const d = db
    .prepare("SELECT * FROM documents WHERE id=? AND company_id=?")
    .get(Number((await params).id), u.company_id) as
    | {
        id: number;
        employee_id: number | null;
        name: string;
        mime: string;
        bytes: Uint8Array;
      }
    | undefined;
  if (
    !d ||
    (u.access !== "admin" &&
      d.employee_id !== null &&
      d.employee_id !== u.employee_id)
  )
    return Response.json({ error: "Document not found." }, { status: 404 });
  return new Response(new Uint8Array(d.bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(d.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "sandbox",
    },
  });
}
export async function DELETE(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const u = await requireUser(r, true);
  if (u instanceof Response) return u;
  const id = Number((await params).id);
  const result = db
    .prepare("DELETE FROM documents WHERE id=? AND company_id=?")
    .run(id, u.company_id);
  if (!result.changes)
    return Response.json({ error: "Document not found." }, { status: 404 });
  audit(u, "Document deleted", String(id));
  return Response.json({ ok: true });
}
