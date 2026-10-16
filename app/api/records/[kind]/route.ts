import { currentUser, requireUser } from "@/lib/auth";
import { listRecords, writeRecord } from "@/lib/records";
export async function GET(
  _r: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  try {
    return Response.json(
      { rows: listRecords(user, (await params).kind) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Module not found." }, { status: 404 });
  }
}
async function save(
  request: Request,
  params: Promise<{ kind: string }>,
  update: boolean,
) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  try {
    const b = await request.json();
    if (update && (!Number.isSafeInteger(b.id) || b.id < 1))
      throw Error("Invalid record ID.");
    const id = writeRecord(
      user,
      (await params).kind,
      b,
      update ? b.id : undefined,
    );
    return Response.json({ ok: true, id }, { status: update ? 200 : 201 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to save." },
      { status: 400 },
    );
  }
}
export async function POST(
  r: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  return save(r, params, false);
}
export async function PATCH(
  r: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  return save(r, params, true);
}
