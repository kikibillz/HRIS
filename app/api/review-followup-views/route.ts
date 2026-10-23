import { currentUser, requireUser } from "@/lib/auth";
import { followupViews, saveFollowupView } from "@/lib/review-followup-views";
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
    { views: followupViews(user), archived_views: followupViews(user, true) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function POST(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("Invalid saved view.");
    return Response.json({ ok: true, ...saveFollowupView(user, body) });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to save view." },
      { status: 400 },
    );
  }
}
