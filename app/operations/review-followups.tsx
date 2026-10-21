"use client";
import { useState } from "react";
import { api, dateTime, type Context, type Row } from "./types";
export default function ReviewFollowups({
  row,
  context,
  onSaved,
}: {
  row: Row;
  context: Context;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [requestKey, setRequestKey] = useState("");
  const requests = row.followups ?? [],
    admin = context.user.access === "admin",
    own = context.user.employee_id === row.employee_id;
  if (!admin && !own) return null;
  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("review-followups", body);
      setMessage(
        body.action === "request"
          ? "Follow-up request sent to HR."
          : "HR response recorded and follow-up resolved.",
      );
      await onSaved();
      if (body.action === "request") setRequestKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save follow-up.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>Review follow-up</h3>
      <p>
        Questions and HR responses are visible to you and HR. Your published
        review and acknowledgment remain unchanged.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {requests.map((request) => (
        <article key={request.id} className="ops-record">
          <p>
            Follow-up #{request.id} · {request.status} ·{" "}
            {dateTime(request.created)}
          </p>
          <p className="preserve-lines">{request.question}</p>
          {request.resolved_at && (
            <>
              <p>
                HR response · {request.resolved_by} ·{" "}
                {dateTime(request.resolved_at)}
              </p>
              <p className="preserve-lines">{request.resolution_note}</p>
            </>
          )}
          {admin && request.status === "Open" && (
            <form
              className="ops-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save({
                  action: "resolve",
                  request_id: request.id,
                  note: new FormData(e.currentTarget).get("note"),
                });
              }}
            >
              <label>
                HR response
                <textarea
                  name="note"
                  aria-label={`HR response · Follow-up #${request.id}`}
                  required
                  maxLength={4000}
                  disabled={busy}
                />
              </label>
              <p>
                Your response will be shared with the employee and saved as the
                final resolution.
              </p>
              <button className="primary" disabled={busy}>
                Record response and resolve
              </button>
            </form>
          )}
        </article>
      ))}
      {own && !requests.some((request) => request.status === "Open") && (
        <form
          className="ops-form"
          onSubmit={(e) => {
            e.preventDefault();
            const key = requestKey || crypto.randomUUID();
            setRequestKey(key);
            void save({
              action: "request",
              record_id: row.id,
              review_hash: row.review_hash,
              request_key: key,
              question: new FormData(e.currentTarget).get("question"),
            });
          }}
        >
          <label>
            Question for HR
            <textarea
              name="question"
              aria-label={`Question for HR · ${row.title}`}
              required
              maxLength={4000}
              disabled={busy}
            />
          </label>
          <button className="primary" disabled={busy}>
            Request HR follow-up
          </button>
        </form>
      )}
      {own && requests.some((request) => request.status === "Open") && (
        <p>HR is reviewing your open follow-up request.</p>
      )}
    </section>
  );
}
