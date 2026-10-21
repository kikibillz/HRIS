import { createHash } from "node:crypto";
import { db } from "./db";
import type { User } from "./auth";
import { audit } from "./tenant";

export function publishedReviewHash(record: Record<string, unknown>) {
  const keys = [
    "id",
    "company_id",
    "kind",
    "employee_id",
    "reviewer_id",
    "title",
    "body",
    "status",
    "progress",
    "due",
    "reference_id",
    "data",
    "created_by",
    "created",
  ];
  return createHash("sha256")
    .update(JSON.stringify(keys.map((key) => record[key])))
    .digest("hex");
}
export function reviewAcknowledgment(recordId: number, companyId: number) {
  return (
    db
      .prepare(
        "SELECT record_id,employee_id,actor_id,review_hash,created FROM review_acknowledgments WHERE record_id=? AND company_id=?",
      )
      .get(recordId, companyId) ?? null
  );
}
export function acknowledgeReview(user: User, b: Record<string, unknown>) {
  if (!Number.isSafeInteger(b.record_id) || Number(b.record_id) < 1)
    throw Error("Invalid review ID.");
  if (b.confirmed !== true)
    throw Error("Confirm that you have received and read this review.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const record = db
      .prepare(
        "SELECT * FROM hr_records WHERE id=? AND company_id=? AND kind='reviews' AND employee_id=? AND status='Published'",
      )
      .get(Number(b.record_id), user.company_id, user.employee_id);
    if (!record)
      throw Error("Published review not available for your acknowledgment.");
    const hash = publishedReviewHash(record);
    if (typeof b.review_hash !== "string" || b.review_hash !== hash)
      throw Error(
        "The review does not match. Refresh and read the published review again.",
      );
    const existing = reviewAcknowledgment(Number(record.id), user.company_id);
    if (existing && existing.review_hash !== hash)
      throw Error(
        "The acknowledgment evidence does not match this review. Contact HR.",
      );
    if (!existing) {
      db.prepare(
        "INSERT INTO review_acknowledgments(record_id,company_id,employee_id,actor_id,review_hash,snapshot) VALUES (?,?,?,?,?,?)",
      ).run(
        Number(record.id),
        user.company_id,
        user.employee_id,
        user.id,
        hash,
        JSON.stringify(record),
      );
      audit(user, "Published review acknowledged", String(record.id));
    }
    const receipt = reviewAcknowledgment(Number(record.id), user.company_id);
    db.exec("COMMIT");
    return { acknowledgment: receipt, already_acknowledged: !!existing };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
