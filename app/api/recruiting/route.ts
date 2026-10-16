import { currentUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hiringSnapshot } from "@/lib/recruiting";
import { audit, notify } from "@/lib/tenant";
export const dynamic = "force-dynamic";
export async function GET() {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  const admin = user.access === "admin";
  const candidates = db
    .prepare(
      `SELECT a.id,a.title,a.status,j.title AS job FROM hr_records a JOIN hr_records j ON j.id=a.reference_id AND j.company_id=a.company_id AND j.kind='jobs' WHERE a.company_id=? AND a.kind='applicants' ${admin ? "" : "AND (EXISTS(SELECT 1 FROM recruiting_scorecards s WHERE s.applicant_id=a.id AND s.company_id=a.company_id AND s.interviewer_id=?) OR (?='manager' AND EXISTS(SELECT 1 FROM recruiting_approvals v WHERE v.applicant_id=a.id AND v.company_id=a.company_id AND v.approver_id=?)))"} ORDER BY a.id DESC`,
    )
    .all(user.company_id, ...(admin ? [] : [user.id, user.access, user.id]));
  const cards = db
    .prepare(
      `SELECT * FROM recruiting_scorecards WHERE company_id=? ${admin ? "" : "AND interviewer_id=?"} ORDER BY id DESC`,
    )
    .all(user.company_id, ...(admin ? [] : [user.id]));
  const approvals =
    admin || user.access === "manager"
      ? db
          .prepare(
            `SELECT v.*,r.name AS requester_name,p.name AS approver_name FROM recruiting_approvals v JOIN accounts ra ON ra.id=v.requested_by JOIN employees r ON r.id=ra.employee_id JOIN accounts pa ON pa.id=v.approver_id JOIN employees p ON p.id=pa.employee_id WHERE v.company_id=? ${admin ? "" : "AND v.approver_id=?"} ORDER BY v.id DESC`,
          )
          .all(user.company_id, ...(admin ? [] : [user.id]))
      : [];
  const interviewers = admin
    ? db
        .prepare(
          "SELECT a.id,e.name,a.access FROM accounts a JOIN employees e ON e.id=a.employee_id JOIN company_employees ce ON ce.employee_id=e.id WHERE ce.company_id=? AND e.status='Active' ORDER BY e.name",
        )
        .all(user.company_id)
    : [];
  return Response.json(
    { candidates, cards, approvals, interviewers },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  try {
    const b = await request.json();
    if (!["assign", "submit", "request", "decide"].includes(b.action))
      throw Error("Choose a valid recruiting action.");
    if (
      b.action !== "submit" &&
      user.access !== "admin" &&
      !(b.action === "decide" && user.access === "manager")
    )
      return Response.json(
        { error: "Administrator access required." },
        { status: 403 },
      );
    db.exec("BEGIN IMMEDIATE");
    try {
      if (b.action === "submit") {
        if (!Number.isSafeInteger(b.card_id))
          throw Error("Choose an assigned interview.");
        const card = db
          .prepare(
            "SELECT * FROM recruiting_scorecards WHERE id=? AND company_id=? AND interviewer_id=? AND status='Assigned'",
          )
          .get(b.card_id, user.company_id, user.id) as
          { applicant_id: number } | undefined;
        if (!card)
          throw Error("Assigned interview not found or already submitted.");
        const applicant = db
          .prepare(
            "SELECT status FROM hr_records WHERE id=? AND company_id=? AND kind='applicants'",
          )
          .get(card.applicant_id, user.company_id) as
          { status: string } | undefined;
        if (!applicant || ["Hired", "Rejected"].includes(applicant.status))
          throw Error(
            "This candidate is no longer accepting interview responses.",
          );
        const ratings = b.ratings;
        if (
          !ratings ||
          ["knowledge", "problem_solving", "communication"].some(
            (key) =>
              !Number.isInteger(ratings[key]) ||
              ratings[key] < 1 ||
              ratings[key] > 5,
          ) ||
          typeof b.notes !== "string" ||
          !b.notes.trim() ||
          b.notes.length > 4000 ||
          !["Hire", "Hold", "No hire"].includes(b.recommendation)
        )
          throw Error(
            "Provide three ratings from 1–5, evidence notes and a recommendation.",
          );
        db.prepare(
          "UPDATE recruiting_scorecards SET status='Submitted',ratings=?,notes=?,recommendation=?,submitted=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        ).run(
          JSON.stringify({
            knowledge: ratings.knowledge,
            problem_solving: ratings.problem_solving,
            communication: ratings.communication,
          }),
          b.notes.trim(),
          b.recommendation,
          b.card_id,
        );
        audit(user, "Interview scorecard submitted", String(b.card_id));
      } else if (b.action === "decide") {
        if (
          !Number.isSafeInteger(b.approval_id) ||
          !["Approved", "Rejected"].includes(b.decision) ||
          typeof b.note !== "string" ||
          !b.note.trim() ||
          b.note.length > 2000
        )
          throw Error("Choose a decision and provide its rationale.");
        const approval = db
          .prepare(
            "SELECT * FROM recruiting_approvals WHERE id=? AND company_id=? AND approver_id=? AND requested_by<>? AND status='Pending'",
          )
          .get(b.approval_id, user.company_id, user.id, user.id) as
          { applicant_id: number; snapshot_hash: string } | undefined;
        if (!approval)
          throw Error("Pending approval not found for this approver.");
        if (
          b.decision === "Approved" &&
          hiringSnapshot(user.company_id, approval.applicant_id).hash !==
            approval.snapshot_hash
        )
          throw Error(
            "Reviewed evidence has changed. Reject this request and request a fresh review.",
          );
        db.prepare(
          "UPDATE recruiting_approvals SET status=?,decision_note=?,decided=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        ).run(b.decision, b.note.trim(), b.approval_id);
        audit(
          user,
          `Hiring ${b.decision.toLowerCase()}`,
          String(b.approval_id),
        );
      } else {
        if (!Number.isSafeInteger(b.applicant_id))
          throw Error("Choose a candidate.");
        const applicant = db
          .prepare(
            "SELECT id,title,status FROM hr_records WHERE id=? AND company_id=? AND kind='applicants'",
          )
          .get(b.applicant_id, user.company_id) as
          { id: number; title: string; status: string } | undefined;
        if (!applicant || ["Hired", "Rejected"].includes(applicant.status))
          throw Error("Candidate unavailable for interviews or approval.");
        if (b.action === "assign") {
          if (!Number.isSafeInteger(b.interviewer_id))
            throw Error("Choose an interviewer.");
          const reviewer = db
            .prepare(
              "SELECT a.id,a.employee_id,e.name FROM accounts a JOIN employees e ON e.id=a.employee_id JOIN company_employees ce ON ce.employee_id=e.id WHERE a.id=? AND ce.company_id=? AND e.status='Active'",
            )
            .get(b.interviewer_id, user.company_id) as
            { employee_id: number; name: string } | undefined;
          if (!reviewer)
            throw Error("Active interviewer not found in this company.");
          const id = Number(
            db
              .prepare(
                "INSERT INTO recruiting_scorecards(company_id,applicant_id,interviewer_id,interviewer_name) VALUES (?,?,?,?)",
              )
              .run(
                user.company_id,
                applicant.id,
                b.interviewer_id,
                reviewer.name,
              ).lastInsertRowid,
          );
          audit(user, "Interview assigned", String(id));
          notify(
            reviewer.employee_id,
            "Interview assigned",
            `Complete the interview scorecard for ${applicant.title} in Interview scorecards.`,
          );
        } else {
          if (
            !Number.isSafeInteger(b.approver_id) ||
            b.approver_id === user.id ||
            typeof b.note !== "string" ||
            !b.note.trim() ||
            b.note.length > 2000
          )
            throw Error(
              "Choose a different manager or administrator and provide a hiring rationale.",
            );
          const approver = db
            .prepare(
              "SELECT a.employee_id FROM accounts a JOIN employees e ON e.id=a.employee_id JOIN company_employees ce ON ce.employee_id=e.id WHERE a.id=? AND a.access IN ('admin','manager') AND ce.company_id=? AND e.status='Active'",
            )
            .get(b.approver_id, user.company_id) as
            { employee_id: number } | undefined;
          if (!approver)
            throw Error(
              "Active approving manager or administrator not found in this company.",
            );
          const frozen = hiringSnapshot(user.company_id, applicant.id);
          const id = Number(
            db
              .prepare(
                "INSERT INTO recruiting_approvals(company_id,applicant_id,requested_by,approver_id,snapshot,snapshot_hash,request_note) VALUES (?,?,?,?,?,?,?)",
              )
              .run(
                user.company_id,
                applicant.id,
                user.id,
                b.approver_id,
                frozen.snapshot,
                frozen.hash,
                b.note.trim(),
              ).lastInsertRowid,
          );
          audit(user, "Hiring approval requested", String(id));
          notify(
            approver.employee_id,
            "Hiring approval requested",
            `Review the frozen interview evidence for ${applicant.title} in Interview scorecards.`,
          );
        }
      }
      db.exec("COMMIT");
      return Response.json({ ok: true });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Unable to save recruiting decision.",
      },
      { status: 400 },
    );
  }
}
