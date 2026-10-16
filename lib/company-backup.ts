import { createHash, randomUUID } from "node:crypto";
import { db } from "./db";
export const companyBackupLimit = 96 * 1024 * 1024;
const scopedQueries: Record<string, string> = {
  recruiting_scorecards:
    "SELECT * FROM recruiting_scorecards WHERE company_id=?",
  recruiting_approvals: "SELECT * FROM recruiting_approvals WHERE company_id=?",
  onboarding_reminder_settings:
    "SELECT * FROM onboarding_reminder_settings WHERE company_id=?",
  onboarding_reminder_deliveries:
    "SELECT * FROM onboarding_reminder_deliveries WHERE company_id=?",
  onboarding_reminder_runs:
    "SELECT * FROM onboarding_reminder_runs WHERE company_id=?",
  companies: "SELECT * FROM companies WHERE id=?",
  company_recovery_identity:
    "SELECT * FROM company_recovery_identity WHERE company_id=?",
  company_employees: "SELECT * FROM company_employees WHERE company_id=?",
  company_departments: "SELECT * FROM company_departments WHERE company_id=?",
  employees:
    "SELECT e.* FROM employees e JOIN company_employees ce ON ce.employee_id=e.id WHERE ce.company_id=?",
  departments:
    "SELECT d.* FROM departments d JOIN company_departments cd ON cd.department_id=d.id WHERE cd.company_id=?",
  accounts:
    "SELECT a.id,a.employee_id,a.email,a.access FROM accounts a JOIN company_employees ce ON ce.employee_id=a.employee_id WHERE ce.company_id=?",
  leaves:
    "SELECT l.* FROM leaves l JOIN company_employees ce ON ce.employee_id=l.employee_id WHERE ce.company_id=?",
  leave_details:
    "SELECT d.* FROM leave_details d JOIN leaves l ON l.id=d.leave_id JOIN company_employees ce ON ce.employee_id=l.employee_id WHERE ce.company_id=?",
  leave_events:
    "SELECT v.* FROM leave_events v JOIN leaves l ON l.id=v.leave_id JOIN company_employees ce ON ce.employee_id=l.employee_id WHERE ce.company_id=?",
  reporting_lines:
    "SELECT r.* FROM reporting_lines r JOIN company_employees ce ON ce.employee_id=r.employee_id WHERE ce.company_id=?",
  reporting_events:
    "SELECT r.* FROM reporting_events r JOIN company_employees ce ON ce.employee_id=r.employee_id WHERE ce.company_id=?",
  security_events:
    "SELECT s.* FROM security_events s JOIN company_employees ce ON ce.employee_id=s.employee_id WHERE ce.company_id=?",
  attendance:
    "SELECT a.* FROM attendance a JOIN company_employees ce ON ce.employee_id=a.employee_id WHERE ce.company_id=?",
  notifications:
    "SELECT n.* FROM notifications n JOIN company_employees ce ON ce.employee_id=n.employee_id WHERE ce.company_id=?",
  compensation:
    "SELECT c.* FROM compensation c JOIN company_employees ce ON ce.employee_id=c.employee_id WHERE ce.company_id=?",
  hr_records: "SELECT * FROM hr_records WHERE company_id=?",
  hr_record_events:
    "SELECT ev.* FROM hr_record_events ev JOIN hr_records r ON r.id=ev.record_id WHERE r.company_id=?",
  documents: "SELECT * FROM documents WHERE company_id=?",
  audit_log: "SELECT * FROM audit_log WHERE company_id=?",
  company_settings: "SELECT * FROM company_settings WHERE company_id=?",
  payroll_runs: "SELECT * FROM payroll_runs WHERE company_id=?",
  payroll_items:
    "SELECT i.* FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id WHERE r.company_id=?",
  payments:
    "SELECT p.* FROM payments p JOIN payroll_runs r ON r.id=p.run_id WHERE r.company_id=?",
  payroll_adjustments: "SELECT * FROM payroll_adjustments WHERE company_id=?",
  payroll_openings: "SELECT * FROM payroll_openings WHERE company_id=?",
  payroll_opening_events:
    "SELECT * FROM payroll_opening_events WHERE company_id=?",
  payroll_reviews:
    "SELECT v.* FROM payroll_reviews v JOIN payroll_runs r ON r.id=v.run_id WHERE r.company_id=?",
  payroll_settlements: "SELECT * FROM payroll_settlements WHERE company_id=?",
  payroll_settlement_voids:
    "SELECT v.* FROM payroll_settlement_voids v JOIN payroll_settlements s ON s.id=v.settlement_id WHERE s.company_id=?",
  payroll_export_settings:
    "SELECT * FROM payroll_export_settings WHERE company_id=?",
  payroll_export_profiles:
    "SELECT * FROM payroll_export_profiles WHERE company_id=?",
  payroll_export_artifacts:
    "SELECT * FROM payroll_export_artifacts WHERE company_id=?",
};
export type CompanyArchive = {
  format: "hris-company-v1";
  company_id: number;
  recovery_id: string;
  created: string;
  excluded: string[];
  tables: Record<string, Record<string, unknown>[]>;
};
const serialise = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.keys(row)
      .sort()
      .map((k) => [
        k,
        row[k] instanceof Uint8Array
          ? {
              encoding: "base64",
              data: Buffer.from(row[k] as Uint8Array).toString("base64"),
            }
          : row[k],
      ]),
  );
export function companyArchive(company: number): CompanyArchive {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "INSERT OR IGNORE INTO company_recovery_identity(company_id,public_id) VALUES(?,?)",
    ).run(company, randomUUID());
    const identity = db
      .prepare(
        "SELECT public_id FROM company_recovery_identity WHERE company_id=?",
      )
      .get(company) as { public_id: string };
    const tables = Object.fromEntries(
      Object.entries(scopedQueries).map(([table, query]) => [
        table,
        db
          .prepare(query)
          .all(company)
          .map((r) => serialise(r)),
      ]),
    );
    const archive: CompanyArchive = {
      format: "hris-company-v1",
      company_id: company,
      recovery_id: identity.public_id,
      created: new Date().toISOString(),
      excluded: [
        "Password hashes",
        "Sessions",
        "Account invitation/reset tokens",
        "Login and password attempt counters",
        "AI usage counters",
      ],
      tables,
    };
    db.exec("COMMIT");
    return archive;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function tableHash(rows: Record<string, unknown>[]) {
  return createHash("sha256")
    .update(
      JSON.stringify(rows.map((r) => JSON.stringify(serialise(r))).sort()),
    )
    .digest("hex");
}
export function compareCompanyArchive(value: unknown, company: number) {
  const backup = value as CompanyArchive;
  if (
    !backup ||
    backup.format !== "hris-company-v1" ||
    backup.company_id !== company ||
    !backup.tables ||
    typeof backup.tables !== "object"
  )
    throw Error("Archive does not match this company or supported format.");
  const identity = db
    .prepare(
      "SELECT public_id FROM company_recovery_identity WHERE company_id=?",
    )
    .get(company) as { public_id: string } | undefined;
  if (!identity || identity.public_id !== backup.recovery_id)
    throw Error(
      "Archive belongs to another company or workspace installation.",
    );
  if (
    Object.keys(backup.tables).sort().join("|") !==
      Object.keys(scopedQueries).sort().join("|") ||
    Object.values(backup.tables).some(
      (rows) =>
        !Array.isArray(rows) ||
        rows.some((r) => !r || typeof r !== "object" || Array.isArray(r)),
    )
  )
    throw Error("Invalid company archive table data.");
  const current = companyArchive(company);
  const comparison = Object.keys(scopedQueries).map((table) => ({
    table,
    backup_rows: backup.tables[table].length,
    current_rows: current.tables[table].length,
    changed:
      tableHash(backup.tables[table]) !== tableHash(current.tables[table]),
  }));
  return {
    created: backup.created,
    company_id: company,
    comparison,
    changed_tables: comparison.filter((r) => r.changed).length,
    restore_supported: false,
    message:
      "Read-only comparison. No records were replaced. Company archives exclude credentials; full database recovery uses the operator CLI into a new directory.",
  };
}
