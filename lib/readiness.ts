import { DatabaseSync } from "node:sqlite";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";
export function ready(dir: string) {
  let db: DatabaseSync | undefined;
  try {
    accessSync(dir, constants.W_OK);
    const path = join(dir, "hris.sqlite");
    accessSync(path, constants.R_OK | constants.W_OK);
    db = new DatabaseSync(path, { readOnly: true });
    db.exec("PRAGMA busy_timeout=1000");
    // Resolve required columns without reading employee records or running migrations.
    const required = {
      accounts: "id,employee_id,email,password_hash,access",
      companies: "id",
      employees: "id,status",
      company_recovery_identity: "company_id",
      hr_records: "id,company_id,kind,status,data",
      performance_cycles: "id,company_id,status",
      performance_assignments: "cycle_id,employee_id,record_id",
      performance_reminders: "record_id,day,company_id",
      performance_reassignments: "id,company_id,snapshot",
      review_acknowledgments: "record_id,company_id,review_hash,snapshot",
      acknowledgment_reminders: "record_id,day,company_id",
      performance_summaries: "id,company_id,content_hash,snapshot",
      review_followups: "id,company_id,employee_id,question,status",
      review_followup_resolutions: "request_id,company_id,note",
      review_followup_assignments: "request_id,company_id,owner_id,due,version",
      review_followup_assignment_events:
        "id,company_id,before_snapshot,after_snapshot",
      review_followup_alerts: "id,company_id,kind,day",
      review_followup_alert_deliveries: "alert_id,account_id,notification_id",
      review_followup_summaries: "id,company_id,content_hash,snapshot",
      review_followup_batches:
        "id,company_id,actor_name,preview_hash,snapshot,result_json",
      review_followup_views:
        "id,company_id,account_id,filters_json,version,archived,pinned",
    };
    for (const [table, columns] of Object.entries(required))
      db.prepare(`SELECT ${columns} FROM ${table} LIMIT 0`).get();
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}
