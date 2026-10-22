import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const dir = process.env.HRIS_DATA_DIR || join(process.cwd(), "data");
mkdirSync(dir, { recursive: true });
export const db = new DatabaseSync(join(dir, "hris.sqlite"));
db.exec(`PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL, department_id INTEGER NOT NULL REFERENCES departments(id), joined TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Active');
CREATE TABLE IF NOT EXISTS leaves (id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), type TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending');`);
db.exec("BEGIN IMMEDIATE");
if (
  process.env.HRIS_DEPLOYMENT !== "production" &&
  !(db.prepare("SELECT COUNT(*) AS n FROM departments").get() as { n: number })
    .n
) {
  try {
    for (const name of [
      "Engineering",
      "Design",
      "Marketing",
      "People & Culture",
      "Finance",
    ])
      db.prepare("INSERT INTO departments(name) VALUES (?)").run(name);
    const people = [
      ["Olivia Rhye", "olivia@peopleos.demo", "Product Designer", 2],
      ["Phoenix Baker", "phoenix@peopleos.demo", "Engineering Lead", 1],
      ["Lana Steiner", "lana@peopleos.demo", "People Partner", 4],
      ["Demi Wilkinson", "demi@peopleos.demo", "Marketing Manager", 3],
      ["Drew Cano", "drew@peopleos.demo", "Frontend Developer", 1],
      ["Natali Craig", "natali@peopleos.demo", "Finance Analyst", 5],
      ["Andi Lane", "andi@peopleos.demo", "UX Researcher", 2],
      ["Kate Morrison", "kate@peopleos.demo", "Software Engineer", 1],
    ];
    for (const [name, email, role, department] of people)
      db.prepare(
        "INSERT INTO employees(name,email,role,department_id,joined) VALUES (?,?,?,?,?)",
      ).run(name, email, role, department, "2026-09-01");
    db.prepare(
      "INSERT INTO leaves(employee_id,type,start,end) VALUES (?,?,?,?)",
    ).run(1, "Annual leave", "2026-10-20", "2026-10-23");
    db.prepare(
      "INSERT INTO leaves(employee_id,type,start,end) VALUES (?,?,?,?)",
    ).run(4, "Personal leave", "2026-10-22", "2026-10-22");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
db.exec("COMMIT");
export function snapshot(companyId: number) {
  return {
    employees: db
      .prepare(
        "SELECT e.*, cd.display_name AS department, r.manager_id, m.name AS manager_name, own.access AS account_access FROM employees e JOIN departments d ON d.id=e.department_id LEFT JOIN reporting_lines r ON r.employee_id=e.id LEFT JOIN accounts a ON a.id=r.manager_id LEFT JOIN employees m ON m.id=a.employee_id LEFT JOIN accounts own ON own.employee_id=e.id JOIN company_employees ce ON ce.employee_id=e.id JOIN company_departments cd ON cd.department_id=d.id WHERE ce.company_id=? ORDER BY e.id DESC",
      )
      .all(companyId),
    departments: db
      .prepare(
        "SELECT d.id, cd.display_name AS name, COUNT(e.id) AS count FROM departments d JOIN company_departments cd ON cd.department_id=d.id LEFT JOIN employees e ON e.department_id=d.id WHERE cd.company_id=? GROUP BY d.id",
      )
      .all(companyId),
    leaves: db
      .prepare(
        "SELECT l.*, e.name, e.role FROM leaves l JOIN employees e ON e.id=l.employee_id JOIN company_employees ce ON ce.employee_id=e.id WHERE ce.company_id=? ORDER BY l.id DESC",
      )
      .all(companyId),
  };
}

// Additive migrations preserve the original prototype records.
db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
 id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL UNIQUE REFERENCES employees(id),
 email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 access TEXT NOT NULL CHECK(access IN ('admin','manager','employee'))
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (email TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS leave_details (leave_id INTEGER PRIMARY KEY REFERENCES leaves(id), reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS leave_events (
 id INTEGER PRIMARY KEY, leave_id INTEGER NOT NULL REFERENCES leaves(id),
 actor_id INTEGER NOT NULL REFERENCES accounts(id), action TEXT NOT NULL, note TEXT NOT NULL,
 created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);`);

// No inferred reporting lines: existing requests remain available to administrators.
db.exec(`
CREATE TABLE IF NOT EXISTS reporting_lines (
 employee_id INTEGER PRIMARY KEY REFERENCES employees(id),
 manager_id INTEGER NOT NULL REFERENCES accounts(id)
);
CREATE INDEX IF NOT EXISTS reporting_manager ON reporting_lines(manager_id);
CREATE TABLE IF NOT EXISTS reporting_events (
 id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
 manager_id INTEGER REFERENCES accounts(id), actor_id INTEGER NOT NULL REFERENCES accounts(id),
 created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);`);

// Account lifecycle additions never replace existing accounts or password hashes.
db.exec(`
CREATE TABLE IF NOT EXISTS account_links (
 token_hash TEXT PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
 account_id INTEGER REFERENCES accounts(id), purpose TEXT NOT NULL CHECK(purpose IN ('invite','reset')),
 access TEXT NOT NULL CHECK(access IN ('admin','manager','employee')),
 expires INTEGER NOT NULL, used_at INTEGER, created_by INTEGER NOT NULL REFERENCES accounts(id)
);
CREATE INDEX IF NOT EXISTS account_links_employee ON account_links(employee_id);
CREATE TABLE IF NOT EXISTS password_attempts (
 account_id INTEGER PRIMARY KEY REFERENCES accounts(id), attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS security_events (
 id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id),
 actor_id INTEGER REFERENCES accounts(id), action TEXT NOT NULL,
 created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);`);

// Tenant membership is additive: original employee/account rows stay byte-for-byte intact.
db.exec(`
CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY, name TEXT NOT NULL, country TEXT NOT NULL DEFAULT 'NG', currency TEXT NOT NULL DEFAULT 'NGN', created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
INSERT OR IGNORE INTO companies(id,name) VALUES(1,'PeopleOS workspace');
CREATE TABLE IF NOT EXISTS company_employees(employee_id INTEGER PRIMARY KEY REFERENCES employees(id), company_id INTEGER NOT NULL REFERENCES companies(id));
CREATE INDEX IF NOT EXISTS company_employee_scope ON company_employees(company_id,employee_id);
CREATE TABLE IF NOT EXISTS company_departments(department_id INTEGER PRIMARY KEY REFERENCES departments(id), company_id INTEGER NOT NULL REFERENCES companies(id), display_name TEXT NOT NULL, UNIQUE(company_id,display_name));
INSERT OR IGNORE INTO company_employees SELECT id,1 FROM employees;
INSERT OR IGNORE INTO company_departments SELECT id,1,name FROM departments;
CREATE TABLE IF NOT EXISTS hr_records(id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), kind TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', employee_id INTEGER REFERENCES employees(id), reviewer_id INTEGER REFERENCES employees(id), title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Open', progress INTEGER NOT NULL DEFAULT 0, due TEXT NOT NULL DEFAULT '', reference_id INTEGER REFERENCES hr_records(id), created_by INTEGER NOT NULL REFERENCES accounts(id), created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX IF NOT EXISTS hr_record_scope ON hr_records(company_id,kind);
CREATE TABLE IF NOT EXISTS attendance(id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), clock_in TEXT NOT NULL, clock_out TEXT, note TEXT NOT NULL DEFAULT '');
CREATE UNIQUE INDEX IF NOT EXISTS attendance_one_open ON attendance(employee_id) WHERE clock_out IS NULL;
CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), employee_id INTEGER REFERENCES employees(id), name TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, uploaded_by INTEGER NOT NULL REFERENCES accounts(id), created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), title TEXT NOT NULL, body TEXT NOT NULL, read_at TEXT, created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), actor_id INTEGER NOT NULL REFERENCES accounts(id), action TEXT NOT NULL, target TEXT NOT NULL, created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS compensation(employee_id INTEGER PRIMARY KEY REFERENCES employees(id), data TEXT NOT NULL, updated TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS payroll_runs(id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id), period TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Draft', policy TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES accounts(id), created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(company_id,period));
CREATE TABLE IF NOT EXISTS payroll_items(id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES payroll_runs(id), employee_id INTEGER NOT NULL REFERENCES employees(id), details TEXT NOT NULL, UNIQUE(run_id,employee_id));
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL UNIQUE REFERENCES payroll_runs(id), reference TEXT NOT NULL, paid_on TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES accounts(id));
CREATE TABLE IF NOT EXISTS company_settings(company_id INTEGER PRIMARY KEY REFERENCES companies(id), payroll_policy TEXT NOT NULL DEFAULT '{}');
`);

db.exec(`CREATE TABLE IF NOT EXISTS hr_record_events(id INTEGER PRIMARY KEY,record_id INTEGER NOT NULL REFERENCES hr_records(id),status TEXT NOT NULL,actor_id INTEGER NOT NULL REFERENCES accounts(id),created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS assistant_usage(account_id INTEGER PRIMARY KEY REFERENCES accounts(id),calls INTEGER NOT NULL,reset_at INTEGER NOT NULL);`);

// Additive, period-specific inputs. Historical payroll item snapshots are untouched.
db.exec(`CREATE TABLE IF NOT EXISTS payroll_adjustments(
 company_id INTEGER NOT NULL REFERENCES companies(id), employee_id INTEGER NOT NULL REFERENCES employees(id),
 period TEXT NOT NULL, data TEXT NOT NULL, updated_by INTEGER NOT NULL REFERENCES accounts(id),
 updated TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(company_id,employee_id,period));`);

// Opening totals supplement imported history; they never rewrite payroll snapshots.
db.exec(`CREATE TABLE IF NOT EXISTS payroll_openings(
 id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL REFERENCES companies(id),employee_id INTEGER NOT NULL REFERENCES employees(id),
 year INTEGER NOT NULL CHECK(year=2026),through_period TEXT NOT NULL,data TEXT NOT NULL,reviewed_by TEXT NOT NULL,reference TEXT NOT NULL,
 created_by INTEGER NOT NULL REFERENCES accounts(id),updated TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),UNIQUE(company_id,employee_id,year));
CREATE TABLE IF NOT EXISTS payroll_opening_events(
 id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL REFERENCES companies(id),employee_id INTEGER NOT NULL REFERENCES employees(id),
 action TEXT NOT NULL,snapshot TEXT NOT NULL,actor_id INTEGER NOT NULL REFERENCES accounts(id),created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS payroll_reviews(
 id INTEGER PRIMARY KEY,run_id INTEGER NOT NULL UNIQUE REFERENCES payroll_runs(id),reviewed_by TEXT NOT NULL,reference TEXT NOT NULL,notes TEXT NOT NULL,
 snapshot_hash TEXT NOT NULL,recorded_by INTEGER NOT NULL REFERENCES accounts(id),created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));`);

// External-payment records are additive; corrections append a void record.
db.exec(`CREATE TABLE IF NOT EXISTS payroll_settlements(
 id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL REFERENCES companies(id),run_id INTEGER NOT NULL REFERENCES payroll_runs(id),
 obligation TEXT NOT NULL,employee_id INTEGER REFERENCES employees(id),amount INTEGER NOT NULL CHECK(amount>0),reference TEXT NOT NULL,
 paid_on TEXT NOT NULL,note TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES accounts(id),created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(company_id,reference));
CREATE INDEX IF NOT EXISTS payroll_settlement_run ON payroll_settlements(run_id,obligation,employee_id);
CREATE TABLE IF NOT EXISTS payroll_settlement_voids(
 settlement_id INTEGER PRIMARY KEY REFERENCES payroll_settlements(id),reason TEXT NOT NULL,actor_id INTEGER NOT NULL REFERENCES accounts(id),
 created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));`);

// Export corrections never rewrite frozen payroll; generated packs remain immutable.
db.exec(`CREATE TABLE IF NOT EXISTS payroll_export_settings(company_id INTEGER PRIMARY KEY REFERENCES companies(id),data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payroll_export_profiles(company_id INTEGER NOT NULL REFERENCES companies(id),run_id INTEGER NOT NULL REFERENCES payroll_runs(id),employee_id INTEGER NOT NULL REFERENCES employees(id),data TEXT NOT NULL,reference TEXT NOT NULL,updated_by INTEGER NOT NULL REFERENCES accounts(id),PRIMARY KEY(company_id,run_id,employee_id));
CREATE TABLE IF NOT EXISTS payroll_export_artifacts(id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL REFERENCES companies(id),run_id INTEGER NOT NULL REFERENCES payroll_runs(id),kind TEXT NOT NULL,payload TEXT NOT NULL,sha256 TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES accounts(id),created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));`);

// Tenant recovery identity prevents archives from another installation matching by numeric ID.
db.exec(
  `CREATE TABLE IF NOT EXISTS company_recovery_identity(company_id INTEGER PRIMARY KEY REFERENCES companies(id),public_id TEXT NOT NULL UNIQUE);`,
);

// Reminder automation is opt-in; delivery keys survive retries and restarts.
db.exec(`CREATE TABLE IF NOT EXISTS onboarding_reminder_settings(company_id INTEGER PRIMARY KEY REFERENCES companies(id),enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),hour INTEGER NOT NULL DEFAULT 9 CHECK(hour BETWEEN 0 AND 23),updated_by INTEGER NOT NULL REFERENCES accounts(id));
CREATE TABLE IF NOT EXISTS onboarding_reminder_deliveries(id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL REFERENCES companies(id),assignment_id INTEGER NOT NULL REFERENCES hr_records(id),day TEXT NOT NULL,source TEXT NOT NULL CHECK(source IN ('manual','automatic')),actor_id INTEGER REFERENCES accounts(id),notification_id INTEGER NOT NULL REFERENCES notifications(id),created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),UNIQUE(company_id,assignment_id,day));
CREATE TABLE IF NOT EXISTS onboarding_reminder_runs(id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL REFERENCES companies(id),day TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('Running','Completed','Failed')),sent INTEGER NOT NULL DEFAULT 0,skipped INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',started TEXT NOT NULL,finished TEXT,UNIQUE(company_id,day));
CREATE TABLE IF NOT EXISTS onboarding_worker_state(id INTEGER PRIMARY KEY CHECK(id=1),last_tick TEXT NOT NULL,last_error TEXT NOT NULL DEFAULT '');`);

// Interview evidence and hiring decisions are additive; existing applicant rows stay intact.
db.exec(`CREATE TABLE IF NOT EXISTS recruiting_scorecards(id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL REFERENCES companies(id),applicant_id INTEGER NOT NULL REFERENCES hr_records(id),interviewer_id INTEGER NOT NULL REFERENCES accounts(id),interviewer_name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Assigned' CHECK(status IN ('Assigned','Submitted')),ratings TEXT NOT NULL DEFAULT '{}',notes TEXT NOT NULL DEFAULT '',recommendation TEXT NOT NULL DEFAULT '',created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),submitted TEXT,UNIQUE(applicant_id,interviewer_id));
CREATE TABLE IF NOT EXISTS recruiting_approvals(id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL REFERENCES companies(id),applicant_id INTEGER NOT NULL REFERENCES hr_records(id),requested_by INTEGER NOT NULL REFERENCES accounts(id),approver_id INTEGER NOT NULL REFERENCES accounts(id),snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Rejected')),request_note TEXT NOT NULL,decision_note TEXT NOT NULL DEFAULT '',created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),decided TEXT,CHECK(requested_by<>approver_id));
`);

// One reviewed handoff per candidate; account and employee profiles are never overwritten.
db.exec(
  `CREATE TABLE IF NOT EXISTS recruiting_handoffs(applicant_id INTEGER PRIMARY KEY REFERENCES hr_records(id),company_id INTEGER NOT NULL REFERENCES companies(id),employee_id INTEGER NOT NULL REFERENCES employees(id),approval_id INTEGER NOT NULL REFERENCES recruiting_approvals(id),onboarding_assignment_id INTEGER REFERENCES hr_records(id),mode TEXT NOT NULL CHECK(mode IN ('create','link')),snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES accounts(id),created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));`,
);

// Frozen offer documents and responses are separate from short-lived bearer links.
db.exec(`CREATE TABLE IF NOT EXISTS recruiting_offers(id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL REFERENCES companies(id),applicant_id INTEGER NOT NULL REFERENCES hr_records(id),approval_hash TEXT NOT NULL,snapshot TEXT NOT NULL,document_hash TEXT NOT NULL,letter TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Issued' CHECK(status IN ('Issued','Accepted','Declined','Revoked','Expired')),expires INTEGER NOT NULL,created_by INTEGER NOT NULL REFERENCES accounts(id),created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),first_viewed TEXT,response_name TEXT NOT NULL DEFAULT '',responded TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS recruiting_one_issued_offer ON recruiting_offers(applicant_id) WHERE status='Issued';
CREATE TABLE IF NOT EXISTS recruiting_offer_links(token_hash TEXT PRIMARY KEY,offer_id INTEGER NOT NULL UNIQUE REFERENCES recruiting_offers(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS recruiting_offer_events(id INTEGER PRIMARY KEY,offer_id INTEGER NOT NULL REFERENCES recruiting_offers(id),action TEXT NOT NULL,actor_id INTEGER REFERENCES accounts(id),created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));`);

// Close unanswered requests without rewriting their original status, evidence or decision fields.
if (
  !db
    .prepare("PRAGMA table_info(recruiting_approvals)")
    .all()
    .some((c) => c.name === "closed_state") ||
  db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='index' AND name='recruiting_one_pending'",
    )
    .get()
) {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (
      !db
        .prepare("PRAGMA table_info(recruiting_approvals)")
        .all()
        .some((c) => c.name === "closed_state")
    )
      db.exec(
        "ALTER TABLE recruiting_approvals ADD COLUMN closed_state TEXT NOT NULL DEFAULT '' CHECK(closed_state IN ('','Withdrawn','Reassigned'))",
      );
    db.exec(
      "DROP INDEX IF EXISTS recruiting_one_pending; CREATE UNIQUE INDEX IF NOT EXISTS recruiting_one_open_pending ON recruiting_approvals(applicant_id) WHERE status='Pending' AND closed_state='';",
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS recruiting_one_open_pending ON recruiting_approvals(applicant_id) WHERE status='Pending' AND closed_state='';
CREATE TABLE IF NOT EXISTS recruiting_approval_closures(approval_id INTEGER PRIMARY KEY REFERENCES recruiting_approvals(id),company_id INTEGER NOT NULL REFERENCES companies(id),action TEXT NOT NULL CHECK(action IN ('Withdrawn','Reassigned')),replacement_id INTEGER UNIQUE REFERENCES recruiting_approvals(id),actor_id INTEGER NOT NULL REFERENCES accounts(id),reason TEXT NOT NULL,created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),CHECK((action='Withdrawn' AND replacement_id IS NULL) OR (action='Reassigned' AND replacement_id IS NOT NULL)));`);

// Cycles link to existing private review records without changing historical reviews.
db.exec(`CREATE TABLE IF NOT EXISTS performance_cycles(id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL REFERENCES companies(id),title TEXT NOT NULL,start TEXT NOT NULL,due TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Closed')),created_by INTEGER NOT NULL REFERENCES accounts(id),created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS performance_assignments(cycle_id INTEGER NOT NULL REFERENCES performance_cycles(id),employee_id INTEGER NOT NULL REFERENCES employees(id),record_id INTEGER NOT NULL UNIQUE REFERENCES hr_records(id),PRIMARY KEY(cycle_id,employee_id));`);

// Daily reminder keys persist across refreshes/restarts and commit with delivery.
db.exec(`CREATE TABLE IF NOT EXISTS performance_reminders(record_id INTEGER NOT NULL REFERENCES hr_records(id),day TEXT NOT NULL,company_id INTEGER NOT NULL REFERENCES companies(id),reviewer_id INTEGER NOT NULL REFERENCES employees(id),actor_id INTEGER NOT NULL REFERENCES accounts(id),notification_id INTEGER NOT NULL REFERENCES notifications(id),created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),PRIMARY KEY(record_id,day));`);

// Reassignments preserve the exact response handed over and the reason for access changes.
db.exec(`CREATE TABLE IF NOT EXISTS performance_reassignments(id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL REFERENCES companies(id),record_id INTEGER NOT NULL REFERENCES hr_records(id),from_reviewer_id INTEGER NOT NULL REFERENCES employees(id),to_reviewer_id INTEGER NOT NULL REFERENCES employees(id),actor_id INTEGER NOT NULL REFERENCES accounts(id),reason TEXT NOT NULL,snapshot TEXT NOT NULL,created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX IF NOT EXISTS performance_reassignments_record ON performance_reassignments(record_id,id);`);

// Receipt evidence is separate from immutable published reviews.
db.exec(`CREATE TABLE IF NOT EXISTS review_acknowledgments(record_id INTEGER PRIMARY KEY REFERENCES hr_records(id),company_id INTEGER NOT NULL REFERENCES companies(id),employee_id INTEGER NOT NULL REFERENCES employees(id),actor_id INTEGER NOT NULL REFERENCES accounts(id),review_hash TEXT NOT NULL,snapshot TEXT NOT NULL,created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));`);

// Receipt follow-ups are independent of reviewer reminders and remain valid after closure.
db.exec(`CREATE TABLE IF NOT EXISTS acknowledgment_reminders(record_id INTEGER NOT NULL REFERENCES hr_records(id),day TEXT NOT NULL,company_id INTEGER NOT NULL REFERENCES companies(id),employee_id INTEGER NOT NULL REFERENCES employees(id),actor_id INTEGER NOT NULL REFERENCES accounts(id),notification_id INTEGER NOT NULL REFERENCES notifications(id),created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),PRIMARY KEY(record_id,day));`);

// Content-addressed summaries freeze operational completion evidence, not review responses.
db.exec(`CREATE TABLE IF NOT EXISTS performance_summaries(id INTEGER PRIMARY KEY,cycle_id INTEGER NOT NULL REFERENCES performance_cycles(id),company_id INTEGER NOT NULL REFERENCES companies(id),content_hash TEXT NOT NULL,snapshot TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES accounts(id),created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),UNIQUE(cycle_id,content_hash));`);

// Follow-up questions and HR resolutions are separate from published review evidence.
db.exec(`CREATE TABLE IF NOT EXISTS review_followups(id INTEGER PRIMARY KEY,record_id INTEGER NOT NULL REFERENCES hr_records(id),company_id INTEGER NOT NULL REFERENCES companies(id),employee_id INTEGER NOT NULL REFERENCES employees(id),actor_id INTEGER NOT NULL REFERENCES accounts(id),request_key TEXT NOT NULL,question TEXT NOT NULL,review_hash TEXT NOT NULL,snapshot TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Resolved')),created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),UNIQUE(company_id,request_key));
CREATE UNIQUE INDEX IF NOT EXISTS review_one_open_followup ON review_followups(record_id) WHERE status='Open';
CREATE TABLE IF NOT EXISTS review_followup_resolutions(request_id INTEGER PRIMARY KEY REFERENCES review_followups(id),company_id INTEGER NOT NULL REFERENCES companies(id),actor_id INTEGER NOT NULL REFERENCES accounts(id),note TEXT NOT NULL,created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));`);

// Internal ownership is versioned independently from employee questions and final responses.
db.exec(`CREATE TABLE IF NOT EXISTS review_followup_assignments(request_id INTEGER PRIMARY KEY REFERENCES review_followups(id),company_id INTEGER NOT NULL REFERENCES companies(id),owner_id INTEGER REFERENCES accounts(id),due TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL CHECK(version>0),updated_by INTEGER NOT NULL REFERENCES accounts(id),updated TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS review_followup_assignment_events(id INTEGER PRIMARY KEY,request_id INTEGER NOT NULL REFERENCES review_followups(id),company_id INTEGER NOT NULL REFERENCES companies(id),actor_id INTEGER NOT NULL REFERENCES accounts(id),reason TEXT NOT NULL,before_snapshot TEXT NOT NULL,after_snapshot TEXT NOT NULL,created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));`);

// One manual owner reminder/escalation per request and Lagos day; deliveries commit atomically.
db.exec(`CREATE TABLE IF NOT EXISTS review_followup_alerts(id INTEGER PRIMARY KEY,request_id INTEGER NOT NULL REFERENCES review_followups(id),company_id INTEGER NOT NULL REFERENCES companies(id),kind TEXT NOT NULL CHECK(kind IN ('owner_reminder','escalation')),day TEXT NOT NULL,actor_id INTEGER NOT NULL REFERENCES accounts(id),reason TEXT NOT NULL,assignment_snapshot TEXT NOT NULL,created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),UNIQUE(request_id,kind,day));
CREATE TABLE IF NOT EXISTS review_followup_alert_deliveries(alert_id INTEGER NOT NULL REFERENCES review_followup_alerts(id),account_id INTEGER NOT NULL REFERENCES accounts(id),notification_id INTEGER NOT NULL REFERENCES notifications(id),PRIMARY KEY(alert_id,account_id));`);

// Workload snapshots freeze HR coordination metadata without private question/response text.
db.exec(`CREATE TABLE IF NOT EXISTS review_followup_summaries(id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL REFERENCES companies(id),content_hash TEXT NOT NULL,snapshot TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES accounts(id),created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),UNIQUE(company_id,content_hash));`);

// Completed bulk assignments preserve the reviewed plan and safe retry result.
db.exec(`CREATE TABLE IF NOT EXISTS review_followup_batches(id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL REFERENCES companies(id),actor_id INTEGER NOT NULL REFERENCES accounts(id),preview_hash TEXT NOT NULL,input_json TEXT NOT NULL,snapshot TEXT NOT NULL,result_json TEXT NOT NULL,created TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),UNIQUE(company_id,preview_hash));`);
