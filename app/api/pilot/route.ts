import { currentUser, requireUser } from "@/lib/auth";
import { pilotReport, pilotResults, recordPilotResult } from "@/lib/pilot";
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  if (user.access !== "admin")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  const download = new URL(request.url).searchParams.get("download");
  if (download !== null) {
    if (download !== "1")
      return Response.json(
        { error: "Invalid report download." },
        { status: 400 },
      );
    const report = pilotReport(user);
    return new Response(JSON.stringify(report, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="peopleos-pilot-${user.company_id}-${report.payload.generated_at.slice(0, 10)}.json"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
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
