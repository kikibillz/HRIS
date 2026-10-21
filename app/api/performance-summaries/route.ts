import { currentUser } from "@/lib/auth";
import { performanceSummary } from "@/lib/performance-summaries";
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  if (user.access !== "admin")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  const raw = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    return Response.json({ error: "Invalid summary ID." }, { status: 400 });
  const summary = performanceSummary(user, Number(raw));
  if (!summary)
    return Response.json({ error: "Summary not found." }, { status: 404 });
  return new Response(
    JSON.stringify(
      { ...summary, snapshot: JSON.parse(String(summary.snapshot)) },
      null,
      2,
    ),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="review-cycle-${summary.cycle_id}-summary-${summary.id}.json"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
