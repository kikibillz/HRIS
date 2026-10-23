import { currentUser, requireUser } from "@/lib/auth";
import { pilotResults, recordPilotResult } from "@/lib/pilot";
export async function GET() {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  if (user.access !== "admin")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  return Response.json(
    { cases: pilotResults(user) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function POST(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    const b = await request.json();
    if (!b || typeof b !== "object" || Array.isArray(b))
      throw new Error("Invalid pilot result.");
    return Response.json({ ok: true, ...recordPilotResult(user, b) });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error ? e.message : "Unable to record pilot result.",
      },
      { status: 400 },
    );
  }
}
