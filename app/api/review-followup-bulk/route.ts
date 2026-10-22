import { requireUser } from "@/lib/auth";
import { bulkReviewFollowupAssignment } from "@/lib/review-followup-bulk";
export async function POST(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    return Response.json({
      ok: true,
      ...bulkReviewFollowupAssignment(user, await request.json()),
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error ? e.message : "Unable to save bulk assignment.",
      },
      { status: 400 },
    );
  }
}
