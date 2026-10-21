"use client";
import { useState } from "react";
import { api, dateTime, type Context, type Row } from "./types";
export default function ReviewAcknowledgment({
  row,
  context,
  onAcknowledged,
}: {
  row: Row;
  context: Context;
  onAcknowledged: () => Promise<void>;
}) {
  const [receipt, setReceipt] = useState(row.acknowledgment),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const acknowledgment = row.acknowledgment ?? receipt;
  if (acknowledgment)
    return (
      <p role="status">
        Acknowledged by employee · {dateTime(acknowledgment.created)}. Receipt
        only; the published review is unchanged.
      </p>
    );
  if (row.employee_id !== context.user.employee_id)
    return <p>Awaiting employee acknowledgment.</p>;
  return (
    <form
      className="ops-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const confirmed =
          new FormData(e.currentTarget).get("confirmed") === "on";
        setBusy(true);
        setError("");
        try {
          const result = await api("review-acknowledgments", {
            record_id: row.id,
            review_hash: row.review_hash,
            confirmed,
          });
          setReceipt(result.acknowledgment);
          await onAcknowledged();
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Unable to acknowledge review.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        Acknowledgment records that you received and read this review. It does
        not mean you agree with its rating or outcome.
      </p>
      <label className="ops-check">
        <input type="checkbox" name="confirmed" required disabled={busy} />I
        have received and read this review.
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? "Recording acknowledgment…" : "Acknowledge review"}
      </button>
    </form>
  );
}
