import { currentUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/tenant";
export const dynamic = "force-dynamic";
export async function GET() {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  if (user.access !== "admin")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  const settings = db
    .prepare(
      "SELECT enabled,hour FROM onboarding_reminder_settings WHERE company_id=?",
    )
    .get(user.company_id) || { enabled: 0, hour: 9 };
  const worker = db
    .prepare(
      "SELECT last_tick,last_error FROM onboarding_worker_state WHERE id=1",
    )
    .get() as { last_tick: string; last_error: string } | undefined;
  const runs = db
    .prepare(
      "SELECT day,status,sent,skipped,error,started,finished FROM onboarding_reminder_runs WHERE company_id=? ORDER BY day DESC LIMIT 30",
    )
    .all(user.company_id);
  const deliveries = db
    .prepare(
      "SELECT d.id,d.day,d.source,d.created,n.read_at,e.name,a.title FROM onboarding_reminder_deliveries d JOIN notifications n ON n.id=d.notification_id JOIN employees e ON e.id=n.employee_id JOIN hr_records a ON a.id=d.assignment_id AND a.company_id=d.company_id WHERE d.company_id=? ORDER BY d.id DESC LIMIT 100",
    )
    .all(user.company_id);
  return Response.json(
    {
      settings,
      worker: worker
        ? {
            ...worker,
            healthy: Date.now() - Date.parse(worker.last_tick) < 180000,
          }
        : null,
      runs,
      deliveries,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    const b = await request.json();
    if (
      typeof b.enabled !== "boolean" ||
      !Number.isInteger(b.hour) ||
      b.hour < 0 ||
      b.hour > 23
    )
      throw Error();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO onboarding_reminder_settings(company_id,enabled,hour,updated_by) VALUES (?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET enabled=excluded.enabled,hour=excluded.hour,updated_by=excluded.updated_by",
      ).run(user.company_id, b.enabled ? 1 : 0, b.hour, user.id);
      audit(
        user,
        "Onboarding reminder schedule updated",
        `${b.enabled ? "Enabled" : "Disabled"} at ${b.hour}:00 WAT`,
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "Choose an enabled state and a Lagos hour from 0 to 23." },
      { status: 400 },
    );
  }
}
