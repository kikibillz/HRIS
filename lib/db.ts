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
export function snapshot() {
  return {
    employees: db
      .prepare(
        "SELECT e.*, d.name AS department FROM employees e JOIN departments d ON d.id=e.department_id ORDER BY e.id DESC",
      )
      .all(),
    departments: db
      .prepare(
        "SELECT d.*, COUNT(e.id) AS count FROM departments d LEFT JOIN employees e ON e.department_id=d.id GROUP BY d.id",
      )
      .all(),
    leaves: db
      .prepare(
        "SELECT l.*, e.name, e.role FROM leaves l JOIN employees e ON e.id=l.employee_id ORDER BY l.id DESC",
      )
      .all(),
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
