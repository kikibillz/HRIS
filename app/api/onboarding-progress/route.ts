import { currentUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { onboardingDay, onboardingProgress } from "@/lib/onboarding-progress";
import { deliverOnboardingReminder } from "@/lib/onboarding-reminders";
export const dynamic = "force-dynamic";
export async function GET() {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  if (!["admin", "manager"].includes(user.access))
    return Response.json(
      { error: "Manager or administrator access required." },
      { status: 403 },
    );
  const today = onboardingDay();
  return Response.json(
    { today, assignments: onboardingProgress(user, undefined, today) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  if (!["admin", "manager"].includes(user.access))
    return Response.json(
      { error: "Manager or administrator access required." },
      { status: 403 },
    );
  try {
    const b = await request.json();
    if (
      b.action !== "remind" ||
      !Number.isSafeInteger(b.assignment_id) ||
      b.assignment_id < 1
    )
      return Response.json(
        { error: "Choose a valid checklist." },
        { status: 400 },
      );
    db.exec("BEGIN IMMEDIATE");
    try {
      const today = onboardingDay();
      const assignment = onboardingProgress(user, b.assignment_id, today)[0];
      if (!assignment) {
        db.exec("ROLLBACK");
        return Response.json(
          { error: "Checklist not found." },
          { status: 404 },
        );
      }
      const result = deliverOnboardingReminder(
        user.company_id,
        assignment.id,
        today,
        user.id,
      );
      db.exec("COMMIT");
      return Response.json(result);
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch {
    return Response.json(
      { error: "Unable to send reminder." },
      { status: 400 },
    );
  }
}
