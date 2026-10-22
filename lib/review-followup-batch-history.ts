import { createHash } from "node:crypto";
import { db } from "./db";
import type { User } from "./auth";
export function reviewFollowupBatches(user: User) {
  if (user.access !== "admin") throw Error("Administrator access required.");
  return db
    .prepare(
      "SELECT id,actor_id,actor_name,created,input_json,result_json FROM review_followup_batches WHERE company_id=? ORDER BY id DESC",
    )
    .all(user.company_id)
    .map(({ input_json, result_json, ...row }) => {
      const input = JSON.parse(String(input_json));
      return {
        ...row,
        reason: input.reason,
        selected: input.requests.length,
        ...JSON.parse(String(result_json)),
      };
    });
}
export function reviewFollowupBatch(user: User, id: number) {
  if (user.access !== "admin") throw Error("Administrator access required.");
  const row = db
    .prepare(
      "SELECT id,actor_id,actor_name,created,input_json,snapshot,result_json,preview_hash FROM review_followup_batches WHERE id=? AND company_id=?",
    )
    .get(id, user.company_id);
  if (!row) return undefined;
  const payload = {
    format: "peopleos-hr-bulk-assignment-v1",
    batch: {
      id: row.id,
      actor_id: row.actor_id,
      actor_name: row.actor_name || null,
      created: row.created,
    },
    input: JSON.parse(String(row.input_json)),
    plan: JSON.parse(String(row.snapshot)),
    result: JSON.parse(String(row.result_json)),
    preview_hash: row.preview_hash,
  };
  return {
    content_hash: createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex"),
    payload,
  };
}
