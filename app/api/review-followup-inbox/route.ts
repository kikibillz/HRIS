import { currentUser } from "@/lib/auth";
import { followupInbox } from "@/lib/review-followup-inbox";
export async function GET() {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  if (user.access !== "admin")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  return Response.json(followupInbox(user), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
