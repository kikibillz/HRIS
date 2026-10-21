import { requireUser } from "@/lib/auth";
import { acknowledgeReview } from "@/lib/review-acknowledgments";
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  try {
    return Response.json({
      ok: true,
      ...acknowledgeReview(user, await request.json()),
    });
  } catch (e) {
    return Response.json(
      {
        error: e instanceof Error ? e.message : "Unable to acknowledge review.",
      },
      { status: 400 },
    );
  }
}
