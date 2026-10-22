import { createHash } from "node:crypto";
import { db } from "./db";
import type { User } from "./auth";
import { audit } from "./tenant";
import { validDate } from "./leave-policy";
import { applyReviewFollowupAssignment } from "./review-followup-inbox";
export function bulkReviewFollowupAssignment(
  user: User,
  b: Record<string, unknown>,
) {
  if (user.access !== "admin") throw Error("Administrator access required.");
  if (!["preview", "commit"].includes(String(b.action)))
    throw Error("Unknown bulk assignment action.");
  if (
    !Array.isArray(b.requests) ||
    !b.requests.length ||
    b.requests.length > 200
  )
    throw Error("Choose between 1 and 200 open follow-ups.");
  const selected = b.requests as Record<string, unknown>[];
  if (
    selected.some(
      (row) =>
        !row ||
        !Number.isSafeInteger(row.request_id) ||
        Number(row.request_id) < 1 ||
        !Number.isSafeInteger(row.expected_version) ||
        Number(row.expected_version) < 0,
    )
  )
    throw Error("Invalid follow-up selection.");
  if (new Set(selected.map((row) => row.request_id)).size !== selected.length)
    throw Error("Choose each follow-up only once.");
  const requests = selected
    .map((row) => ({
      request_id: Number(row.request_id),
      expected_version: Number(row.expected_version),
    }))
    .sort((a, b) => a.request_id - b.request_id);
  if (
    b.owner_id !== null &&
    (!Number.isSafeInteger(b.owner_id) || Number(b.owner_id) < 1)
  )
    throw Error("Choose an HR owner or unassigned.");
  if (typeof b.due !== "string" || (b.due && !validDate(b.due)))
    throw Error("Enter a valid due date or leave it empty.");
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (!reason || reason.length > 2000)
    throw Error("Provide a batch reason of up to 2000 characters.");
  const input = {
    company_id: user.company_id,
    actor_id: user.id,
    requests,
    owner_id: b.owner_id as number | null,
    due: b.due,
    reason,
  };
  const inputJson = JSON.stringify(input);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (b.action === "commit") {
      if (
        typeof b.preview_hash !== "string" ||
        !/^[0-9a-f]{64}$/.test(b.preview_hash)
      )
        throw Error("Preview the batch before saving.");
      const existing = db
        .prepare(
          "SELECT id,input_json,result_json FROM review_followup_batches WHERE company_id=? AND preview_hash=?",
        )
        .get(user.company_id, b.preview_hash);
      if (existing) {
        if (existing.input_json !== inputJson)
          throw Error("The batch differs from the saved preview.");
        db.exec("COMMIT");
        return {
          ...JSON.parse(String(existing.result_json)),
          batch_id: Number(existing.id),
          reused: true,
        };
      }
    }
    const owner =
      input.owner_id === null
        ? null
        : db
            .prepare(
              "SELECT ac.id,e.name FROM accounts ac JOIN employees e ON e.id=ac.employee_id JOIN company_employees ce ON ce.employee_id=e.id WHERE ac.id=? AND ce.company_id=? AND ac.access='admin' AND e.status='Active'",
            )
            .get(input.owner_id, user.company_id);
    if (input.owner_id !== null && !owner)
      throw Error("Choose an active HR administrator in this company.");
    const plan = requests.map((selection) => {
      const row = db
        .prepare(
          `SELECT f.id,f.record_id,f.status,e.name AS employee_name,assignment.owner_id,previous.name AS owner_name,COALESCE(assignment.due,'') AS due,COALESCE(assignment.version,0) AS version FROM review_followups f JOIN hr_records r ON r.id=f.record_id AND r.company_id=f.company_id JOIN employees e ON e.id=f.employee_id LEFT JOIN review_followup_assignments assignment ON assignment.request_id=f.id LEFT JOIN accounts ac ON ac.id=assignment.owner_id LEFT JOIN employees previous ON previous.id=ac.employee_id WHERE f.id=? AND f.company_id=? AND r.kind='reviews' AND r.status='Published'`,
        )
        .get(selection.request_id, user.company_id);
      if (!row || row.status !== "Open")
        throw Error(
          "Every selected request must be open and belong to this company.",
        );
      if (row.version !== selection.expected_version)
        throw Error(
          "A selected assignment changed. Refresh the inbox and preview again.",
        );
      return {
        ...row,
        new_owner_id: input.owner_id,
        new_owner_name: owner?.name ?? null,
        new_due: input.due,
        changed: row.owner_id !== input.owner_id || row.due !== input.due,
      };
    });
    const hash = createHash("sha256")
      .update(JSON.stringify({ input, plan }))
      .digest("hex");
    if (b.action === "preview") {
      db.exec("COMMIT");
      return {
        preview_hash: hash,
        plan,
        changed: plan.filter((row) => row.changed).length,
        unchanged: plan.filter((row) => !row.changed).length,
      };
    }
    if (b.preview_hash !== hash)
      throw Error(
        "The preview is stale or the batch changed. Preview again before saving.",
      );
    for (const selection of requests)
      applyReviewFollowupAssignment(user, {
        ...selection,
        owner_id: input.owner_id,
        due: input.due,
        reason: input.reason,
      });
    const result = {
      changed: plan.filter((row) => row.changed).length,
      unchanged: plan.filter((row) => !row.changed).length,
    };
    const id = Number(
      db
        .prepare(
          "INSERT INTO review_followup_batches(company_id,actor_id,preview_hash,input_json,snapshot,result_json,actor_name) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          user.company_id,
          user.id,
          hash,
          inputJson,
          JSON.stringify(plan),
          JSON.stringify(result),
          user.name,
        ).lastInsertRowid,
    );
    audit(user, "Bulk review follow-up assignment completed", String(id));
    db.exec("COMMIT");
    return { ...result, batch_id: id, reused: false };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
