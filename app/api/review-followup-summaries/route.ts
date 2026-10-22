import { currentUser, requireUser } from "@/lib/auth";
import {
  followupWorkloadSummaries,
  followupWorkloadSummary,
  saveFollowupWorkloadSummary,
} from "@/lib/review-followup-summaries";
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  if (user.access !== "admin")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  const raw = new URL(request.url).searchParams.get("id");
  if (raw === null)
    return Response.json(
      { summaries: followupWorkloadSummaries(user) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    return Response.json({ error: "Invalid summary ID." }, { status: 400 });
  const row = followupWorkloadSummary(user, Number(raw));
  if (!row)
    return Response.json({ error: "Summary not found." }, { status: 404 });
  return new Response(
    JSON.stringify(
      { ...row, snapshot: JSON.parse(String(row.snapshot)) },
      null,
      2,
    ),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="hr-followup-workload-${row.id}.json"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
export async function POST(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    return Response.json({ ok: true, ...saveFollowupWorkloadSummary(user) });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error ? e.message : "Unable to save workload summary.",
      },
      { status: 400 },
    );
  }
}
