"use client";
import { dateTime } from "./types";
export type PayrollReview = {
  id: number;
  run_id: number;
  reviewed_by: string;
  reference: string;
  notes: string;
  snapshot_hash: string;
  created: string;
};
export default function PayrollReviewForm({
  runId,
  review,
  busy,
  action,
}: {
  runId: number;
  review?: PayrollReview;
  busy: boolean;
  action: (body: unknown) => Promise<void>;
}) {
  return (
    <details className="panel ops-form">
      <summary>External review record</summary>
      {review ? (
        <>
          <p>
            Recorded review by {review.reviewed_by} · {dateTime(review.created)}
            . Reviewer identity is supplied by your payroll administrator.
          </p>
          <p>Evidence reference: {review.reference}</p>
          {review.notes && <p>{review.notes}</p>}
          <p>
            This record is immutable and bound to the released calculations.
          </p>
          <details>
            <summary>Calculation fingerprint (SHA-256)</summary>
            <pre className="ops-code">{review.snapshot_hash}</pre>
          </details>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const b = Object.fromEntries(new FormData(e.currentTarget));
            void action({
              ...b,
              action: "record_review",
              run_id: runId,
              confirmed: b.confirmed === "on",
            });
          }}
        >
          <p>
            Record a review performed outside the app against this released
            payroll. The reviewer’s identity and accountant credentials are not
            verified here; this does not change payslips or initiate payment.
          </p>
          <label>
            External reviewer name
            <input name="reviewed_by" required maxLength={120} />
          </label>
          <label>
            External review evidence reference
            <textarea name="reference" required maxLength={1000} />
          </label>
          <label>
            External review findings
            <textarea name="notes" maxLength={2000} />
          </label>
          <label className="check-label">
            <input type="checkbox" name="confirmed" required />I am recording an
            external review claim with supporting evidence.
          </label>
          <button className="primary" disabled={busy}>
            Record external review
          </button>
        </form>
      )}
    </details>
  );
}
