import { currentUser, requireUser } from "@/lib/auth";
import {
  listReviewFollowups,
  changeReviewFollowup,
} from "@/lib/review-followups";
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  const raw = new URL(request.url).searchParams.get("record_id") ?? "";
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    return Response.json({ error: "Invalid review ID." }, { status: 400 });
  try {
    return Response.json(
      { requests: listReviewFollowups(user, Number(raw)) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Review follow-up not available." },
      { status: 404 },
    );
  }
}
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  try {
    const body = await request.json();
    if (["resolve", "assign"].includes(body?.action) && user.access !== "admin")
      return Response.json(
        { error: "Administrator access required." },
        { status: 403 },
      );
    return Response.json({ ok: true, ...changeReviewFollowup(user, body) });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to save follow-up." },
      { status: 400 },
    );
  }
}
