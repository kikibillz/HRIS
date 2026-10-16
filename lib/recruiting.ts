import { createHash } from "node:crypto";
import { db } from "./db";
export function hiringSnapshot(company: number, applicant: number) {
  const candidate = db
    .prepare(
      "SELECT id,title,body,data,due,reference_id,status FROM hr_records WHERE id=? AND company_id=? AND kind='applicants'",
    )
    .get(applicant, company) as
    | {
        id: number;
        title: string;
        body: string;
        data: string;
        due: string;
        reference_id: number;
        status: string;
      }
    | undefined;
  if (!candidate || ["Hired", "Rejected"].includes(candidate.status))
    throw Error("Candidate unavailable for a hiring decision.");
  const job = db
    .prepare(
      "SELECT id,title,body,data,due,status FROM hr_records WHERE id=? AND company_id=? AND kind='jobs'",
    )
    .get(candidate.reference_id, company) as { status: string } | undefined;
  if (!job || job.status !== "Open")
    throw Error("The job must be open for a hiring decision.");
  const cards = db
    .prepare(
      "SELECT id,interviewer_id,interviewer_name,status,ratings,notes,recommendation,submitted FROM recruiting_scorecards WHERE company_id=? AND applicant_id=? ORDER BY id",
    )
    .all(company, applicant) as { status: string }[];
  if (!cards.length || cards.some((c) => c.status !== "Submitted"))
    throw Error(
      "All assigned interviews must have submitted scorecards before requesting approval.",
    );
  const frozenCandidate = {
    id: candidate.id,
    title: candidate.title,
    body: candidate.body,
    due: candidate.due,
    reference_id: candidate.reference_id,
    email: JSON.parse(candidate.data).email,
  };
  const rejection = db
    .prepare(
      "SELECT MAX(id) AS id FROM hr_record_events WHERE record_id=? AND status='Rejected'",
    )
    .get(applicant);
  const snapshot = JSON.stringify({
    rejection,
    candidate: frozenCandidate,
    job,
    scorecards: cards,
  });
  return {
    snapshot,
    hash: createHash("sha256").update(snapshot).digest("hex"),
  };
}
export function assertHiringApproval(company: number, applicant: number) {
  const current = hiringSnapshot(company, applicant);
  const decision = db
    .prepare(
      "SELECT status,snapshot_hash FROM recruiting_approvals WHERE company_id=? AND applicant_id=? ORDER BY id DESC LIMIT 1",
    )
    .get(company, applicant) as
    { status: string; snapshot_hash: string } | undefined;
  if (
    decision?.status !== "Approved" ||
    decision.snapshot_hash !== current.hash
  )
    throw Error(
      "A current hiring approval from a different approver is required before Offer or Hired.",
    );
}
