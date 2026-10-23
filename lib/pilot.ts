import { createHash } from "node:crypto";
import { db } from "./db";
import type { User } from "./auth";
import { audit } from "./tenant";
import { pilotCases, pilotRoles, pilotStatuses } from "./pilot-cases";
export function pilotResults(user: User) {
  if (user.access !== "admin")
    throw new Error("Administrator access required.");
  const rows = db
    .prepare(
      "SELECT * FROM pilot_results WHERE company_id=? ORDER BY version DESC,id DESC",
    )
    .all(user.company_id);
  return pilotCases.map((item) => {
    const history = rows.filter((row) => row.case_id === item.id);
    return { ...item, latest: history[0] || null, history };
  });
}
export function recordPilotResult(user: User, b: Record<string, unknown>) {
  if (user.access !== "admin")
    throw new Error("Administrator access required.");
  if (
    typeof b.case_id !== "string" ||
    !pilotCases.some((c) => c.id === b.case_id) ||
    typeof b.status !== "string" ||
    !pilotStatuses.includes(b.status) ||
    typeof b.tester_role !== "string" ||
    !pilotRoles.includes(b.tester_role) ||
    !Number.isSafeInteger(b.expected_version) ||
    Number(b.expected_version) < 0
  )
    throw new Error(
      "Choose a valid pilot case, result, tester role and version.",
    );
  const value = (key: string, max: number) => {
    if (
      typeof b[key] !== "string" ||
      !String(b[key]).trim() ||
      String(b[key]).trim().length > max
    )
      throw new Error(`Enter ${key} of up to ${max} characters.`);
    return String(b[key]).trim();
  };
  const tester = value("tester", 100),
    revision = value("revision", 100),
    note = value("note", 2000);
  db.exec("BEGIN IMMEDIATE");
  try {
    const old = db
      .prepare(
        "SELECT * FROM pilot_results WHERE company_id=? AND case_id=? ORDER BY version DESC LIMIT 1",
      )
      .get(user.company_id, b.case_id);
    const version = Number(old?.version || 0);
    if (version !== b.expected_version)
      throw new Error(
        "This pilot result changed. Refresh the checklist before recording another result.",
      );
    if (
      old &&
      old.status === b.status &&
      old.tester === tester &&
      old.tester_role === b.tester_role &&
      old.revision === revision &&
      old.note === note
    ) {
      db.exec("COMMIT");
      return { unchanged: true, version };
    }
    db.prepare(
      "INSERT INTO pilot_results(company_id,case_id,version,status,tester,tester_role,revision,note,actor_id,actor_name) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      user.company_id,
      b.case_id,
      version + 1,
      b.status,
      tester,
      b.tester_role,
      revision,
      note,
      user.id,
      user.name,
    );
    audit(user, "Recorded pilot result", `${b.case_id}:${version + 1}`);
    db.exec("COMMIT");
    return { unchanged: false, version: version + 1 };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// A read-only point-in-time export; explicit fields prevent unrelated account data leaking.
export function pilotReport(user: User) {
  if (user.access !== "admin")
    throw new Error("Administrator access required.");
  db.exec("BEGIN");
  try {
    const company = db
      .prepare("SELECT id,name FROM companies WHERE id=?")
      .get(user.company_id);
    const evidence = (row: Record<string, unknown>) => ({
      id: row.id,
      version: row.version,
      status: row.status,
      tester: row.tester,
      tester_role: row.tester_role,
      revision: row.revision,
      note: row.note,
      recorded_by: { account_id: row.actor_id, name: row.actor_name },
      created: row.created,
    });
    const cases = pilotResults(user).map((item) => ({
      ...item,
      latest: item.latest ? evidence(item.latest) : null,
      history: item.history.map(evidence),
    }));
    const payload = {
      format: "hris-pilot-report-v1",
      company,
      generated_at: new Date().toISOString(),
      display_time_zone: "Africa/Lagos",
      scope:
        "Human-reported workflow observations. Tester identities, roles and app revisions are stated by the recorder.",
      payroll_approval: "Not established by this report.",
      launch_authorization: "Not established by this report.",
      totals: Object.fromEntries(
        pilotStatuses.map((status) => [
          status,
          cases.filter((item) => (item.latest?.status || "Pending") === status)
            .length,
        ]),
      ),
      cases,
    };
    const content_hash = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    db.exec("COMMIT");
    return { content_hash, payload };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
