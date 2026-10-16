import { currentUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { onboardingDay, onboardingProgress } from "@/lib/onboarding-progress";
import { audit, notify } from "@/lib/tenant";
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
      const target = `${assignment.id}:${today}`;
      const already = !!db
        .prepare(
          "SELECT 1 FROM audit_log WHERE company_id=? AND action='Onboarding overdue reminder' AND target=?",
        )
        .get(user.company_id, target);
      const sent = assignment.overdue > 0 && !already;
      if (sent) {
        notify(
          assignment.employee_id,
          "Overdue onboarding tasks",
          `${assignment.title}: ${assignment.overdue} overdue task${assignment.overdue === 1 ? "" : "s"}. Open Onboarding checklists to review and complete them.`,
        );
        audit(user, "Onboarding overdue reminder", target);
      }
      db.exec("COMMIT");
      return Response.json({
        sent,
        reason: sent
          ? "Reminder added to employee notifications."
          : already
            ? "A reminder was already sent today."
            : "No overdue open tasks.",
      });
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
