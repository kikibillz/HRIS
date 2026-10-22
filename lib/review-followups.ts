import { alertReviewFollowup } from "./review-followup-alerts";
import { assignReviewFollowup } from "./review-followup-inbox";
import { db } from "./db";
import type { User } from "./auth";
import { audit, notify } from "./tenant";
import { publishedReviewHash } from "./review-acknowledgments";

export function listReviewFollowups(user: User, recordId: number) {
  const record = db
    .prepare(
      "SELECT employee_id FROM hr_records WHERE id=? AND company_id=? AND kind='reviews' AND status='Published'",
    )
    .get(recordId, user.company_id);
  if (
    !record ||
    (user.access !== "admin" && record.employee_id !== user.employee_id)
  )
    throw Error("Review follow-up not available.");
  return db
    .prepare(
      `SELECT f.id,f.record_id,f.employee_id,f.question,f.review_hash,f.status,f.created,r.note AS resolution_note,r.created AS resolved_at,e.name AS resolved_by
    FROM review_followups f LEFT JOIN review_followup_resolutions r ON r.request_id=f.id
    LEFT JOIN accounts ac ON ac.id=r.actor_id LEFT JOIN employees e ON e.id=ac.employee_id
    WHERE f.record_id=? AND f.company_id=? ORDER BY f.id DESC`,
    )
    .all(recordId, user.company_id);
}
function note(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 4000)
    throw Error(`${label} must contain between 1 and 4000 characters.`);
  return value.trim();
}
export function changeReviewFollowup(user: User, b: Record<string, unknown>) {
  if (["remind_owner", "escalate"].includes(String(b.action)))
    return alertReviewFollowup(user, b);
  if (b.action === "assign") return assignReviewFollowup(user, b);
  db.exec("BEGIN IMMEDIATE");
  try {
    let recordId: number,
      id: number,
      reused = false;
    if (b.action === "request") {
      if (!Number.isSafeInteger(b.record_id) || Number(b.record_id) < 1)
        throw Error("Invalid review ID.");
      const record = db
        .prepare(
          "SELECT * FROM hr_records WHERE id=? AND company_id=? AND kind='reviews' AND status='Published' AND employee_id=?",
        )
        .get(Number(b.record_id), user.company_id, user.employee_id);
      if (!record)
        throw Error(
          "Published review not available for your follow-up request.",
        );
      const question = note(b.question, "Question");
      if (
        typeof b.request_key !== "string" ||
        !/^[A-Za-z0-9_-]{16,100}$/.test(b.request_key)
      )
        throw Error(
          "Refresh the review before submitting a follow-up request.",
        );
      const hash = publishedReviewHash(record);
      if (typeof b.review_hash !== "string" || b.review_hash !== hash)
        throw Error("The review changed. Refresh and read it again.");
      recordId = Number(record.id);
      const existing = db
        .prepare(
          "SELECT * FROM review_followups WHERE company_id=? AND request_key=?",
        )
        .get(user.company_id, b.request_key);
      if (existing) {
        if (
          existing.record_id !== recordId ||
          existing.actor_id !== user.id ||
          existing.question !== question ||
          existing.review_hash !== hash
        )
          throw Error(
            "This request key was already used. Refresh the review before submitting.",
          );
        id = Number(existing.id);
        reused = true;
      } else {
        if (
          db
            .prepare(
              "SELECT 1 FROM review_followups WHERE record_id=? AND status='Open'",
            )
            .get(recordId)
        )
          throw Error(
            "HR is already reviewing an open follow-up for this review.",
          );
        id = Number(
          db
            .prepare(
              "INSERT INTO review_followups(record_id,company_id,employee_id,actor_id,request_key,question,review_hash,snapshot) VALUES (?,?,?,?,?,?,?,?)",
            )
            .run(
              recordId,
              user.company_id,
              user.employee_id,
              user.id,
              b.request_key,
              question,
              hash,
              JSON.stringify(record),
            ).lastInsertRowid,
        );
        audit(user, "Review follow-up requested", String(id));
        const hr = db
          .prepare(
            "SELECT ac.employee_id FROM accounts ac JOIN company_employees ce ON ce.employee_id=ac.employee_id JOIN employees e ON e.id=ac.employee_id WHERE ce.company_id=? AND ac.access='admin' AND e.status='Active'",
          )
          .all(user.company_id);
        for (const admin of hr)
          notify(
            Number(admin.employee_id),
            "Review follow-up requested",
            `Review #${recordId} · Follow-up #${id}. Open Performance reviews to read the employee's question.`,
          );
      }
    } else if (b.action === "resolve") {
      if (user.access !== "admin")
        throw Error("Administrator access required.");
      if (!Number.isSafeInteger(b.request_id) || Number(b.request_id) < 1)
        throw Error("Invalid follow-up ID.");
      const request = db
        .prepare(
          "SELECT f.* FROM review_followups f JOIN hr_records r ON r.id=f.record_id WHERE f.id=? AND f.company_id=? AND r.company_id=? AND r.kind='reviews' AND r.status='Published'",
        )
        .get(Number(b.request_id), user.company_id, user.company_id);
      if (!request) throw Error("Follow-up not found.");
      const resolution = note(b.note, "Resolution");
      id = Number(request.id);
      recordId = Number(request.record_id);
      const existing = db
        .prepare(
          "SELECT note FROM review_followup_resolutions WHERE request_id=?",
        )
        .get(id);
      if (existing) {
        if (existing.note !== resolution)
          throw Error("This follow-up already has a final resolution.");
        reused = true;
      } else {
        db.prepare(
          "INSERT INTO review_followup_resolutions(request_id,company_id,actor_id,note) VALUES (?,?,?,?)",
        ).run(id, user.company_id, user.id, resolution);
        db.prepare(
          "UPDATE review_followups SET status='Resolved' WHERE id=?",
        ).run(id);
        audit(user, "Review follow-up resolved", String(id));
        notify(
          Number(request.employee_id),
          "Review follow-up resolved",
          `Review #${recordId} · Follow-up #${id}. Open Performance reviews to read HR's response.`,
        );
      }
    } else throw Error("Unknown follow-up action.");
    const requests = listReviewFollowups(user, recordId);
    db.exec("COMMIT");
    return { id, reused, requests };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
