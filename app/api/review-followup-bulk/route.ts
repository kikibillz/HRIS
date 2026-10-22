import {
  reviewFollowupBatches,
  reviewFollowupBatch,
} from "@/lib/review-followup-batch-history";
import { currentUser, requireUser } from "@/lib/auth";
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
      { batches: reviewFollowupBatches(user) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    return Response.json({ error: "Invalid batch ID." }, { status: 400 });
  const artifact = reviewFollowupBatch(user, Number(raw));
  if (!artifact)
    return Response.json({ error: "Batch not found." }, { status: 404 });
  return new Response(JSON.stringify(artifact, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="hr-followup-batch-${raw}.json"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
