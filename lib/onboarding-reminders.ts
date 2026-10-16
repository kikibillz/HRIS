import { db } from "./db.ts";
import { onboardingDay } from "./onboarding-date.ts";
// Caller owns the IMMEDIATE transaction. Manual and automated paths use this key.
export function deliverOnboardingReminder(
  company: number,
  assignmentId: number,
  day: string,
  actor: number | null,
) {
  const row = db
    .prepare(
      "SELECT a.id,a.title,a.employee_id,COUNT(t.id) AS overdue FROM hr_records a JOIN employees e ON e.id=a.employee_id JOIN company_employees ce ON ce.employee_id=e.id AND ce.company_id=a.company_id JOIN hr_records t ON t.reference_id=a.id AND t.kind='tasks' AND t.company_id=a.company_id AND t.employee_id=a.employee_id WHERE a.id=? AND a.company_id=? AND a.kind='onboarding_assignment' AND e.status='Active' AND t.status='Open' AND t.due<>'' AND t.due<? GROUP BY a.id",
    )
    .get(assignmentId, company, day) as
    | { id: number; title: string; employee_id: number; overdue: number }
    | undefined;
  if (!row) return { sent: false, reason: "No overdue open tasks." };
  const target = `${assignmentId}:${day}`;
  if (
    db
      .prepare(
        "SELECT 1 FROM onboarding_reminder_deliveries WHERE company_id=? AND assignment_id=? AND day=?",
      )
      .get(company, assignmentId, day) ||
    db
      .prepare(
        "SELECT 1 FROM audit_log WHERE company_id=? AND action='Onboarding overdue reminder' AND target=?",
      )
      .get(company, target)
  )
    return { sent: false, reason: "A reminder was already sent today." };
  const notification = Number(
    db
      .prepare(
        "INSERT INTO notifications(employee_id,title,body) VALUES (?,'Overdue onboarding tasks',?)",
      )
      .run(
        row.employee_id,
        `${row.title}: ${row.overdue} overdue task${row.overdue === 1 ? "" : "s"}. Open Onboarding checklists to review and complete them.`,
      ).lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO onboarding_reminder_deliveries(company_id,assignment_id,day,source,actor_id,notification_id) VALUES (?,?,?,?,?,?)",
  ).run(
    company,
    assignmentId,
    day,
    actor === null ? "automatic" : "manual",
    actor,
    notification,
  );
  if (actor !== null)
    db.prepare(
      "INSERT INTO audit_log(company_id,actor_id,action,target) VALUES (?,?,'Onboarding overdue reminder',?)",
    ).run(company, actor, target);
  return { sent: true, reason: "Reminder added to employee notifications." };
}
export function runScheduledReminders(now = new Date()) {
  const stamp = now.toISOString(),
    day = onboardingDay(now);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Lagos",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  let failed = 0,
    completed = 0;
  const companies = db
    .prepare(
      "SELECT company_id FROM onboarding_reminder_settings WHERE enabled=1 AND hour<=?",
    )
    .all(hour) as { company_id: number }[];
  for (const { company_id: company } of companies) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (
        !db
          .prepare(
            "SELECT 1 FROM onboarding_reminder_settings WHERE company_id=? AND enabled=1 AND hour<=?",
          )
          .get(company, hour) ||
        db
          .prepare(
            "SELECT 1 FROM onboarding_reminder_runs WHERE company_id=? AND day=? AND status='Completed'",
          )
          .get(company, day)
      ) {
        db.exec("COMMIT");
        continue;
      }
      db.prepare(
        "INSERT INTO onboarding_reminder_runs(company_id,day,status,started) VALUES (?,?,'Running',?) ON CONFLICT(company_id,day) DO UPDATE SET status='Running',started=excluded.started,finished=NULL,error='',sent=0,skipped=0",
      ).run(company, day, stamp);
      const assignments = db
        .prepare(
          "SELECT id FROM hr_records WHERE company_id=? AND kind='onboarding_assignment'",
        )
        .all(company) as { id: number }[];
      let sent = 0,
        skipped = 0;
      for (const assignment of assignments) {
        if (deliverOnboardingReminder(company, assignment.id, day, null).sent)
          sent++;
        else skipped++;
      }
      db.prepare(
        "UPDATE onboarding_reminder_runs SET status='Completed',sent=?,skipped=?,finished=? WHERE company_id=? AND day=?",
      ).run(sent, skipped, stamp, company, day);
      db.exec("COMMIT");
      completed++;
    } catch {
      db.exec("ROLLBACK");
      failed++;
      db.prepare(
        "INSERT INTO onboarding_reminder_runs(company_id,day,status,error,started,finished) VALUES (?,?,'Failed','Reminder batch failed; it will be retried.',?,?) ON CONFLICT(company_id,day) DO UPDATE SET status='Failed',error=excluded.error,finished=excluded.finished",
      ).run(company, day, stamp, stamp);
    }
  }
  db.prepare(
    "INSERT INTO onboarding_worker_state(id,last_tick,last_error) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET last_tick=excluded.last_tick,last_error=excluded.last_error",
  ).run(stamp, failed ? "One or more batches failed." : "");
  return { completed, failed };
}
