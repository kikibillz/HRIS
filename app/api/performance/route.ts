import { currentUser, requireUser } from "@/lib/auth";
import { performanceCycles, changePerformance } from "@/lib/performance";
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
    { cycles: performanceCycles(user) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  if (user.access !== "admin")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  try {
    return Response.json({
      ok: true,
      ...changePerformance(user, await request.json()),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to save cycle." },
      { status: 400 },
    );
  }
}
