"use client";
import { useEffect, useState } from "react";
import { api, dateTime, type Context } from "./types";
type Cycle = {
  id: number;
  title: string;
  start: string;
  due: string;
  status: string;
  assigned: number;
  submitted: number;
  published: number;
  acknowledged: number;
  awaiting_acknowledgment: number;
  pending: number;
  summaries: {
    id: number;
    created: string;
    content_hash: string;
    snapshot: {
      totals: {
        assigned: number;
        acknowledged: number;
        awaiting_acknowledgment: number;
        acknowledgment_percent: number | null;
        unavailable_for_followup: number;
      };
    };
  }[];
  overdue: number;
  assignments: {
    id: number;
    employee_id: number;
    reviewer_id: number;
    revision: string;
    history: {
      id: number;
      reason: string;
      created: string;
      from_name: string;
      to_name: string;
      actor_name: string;
      snapshot: string;
    }[];
    employee_name: string;
    reviewer_name: string;
    status: string;
    due: string;
    overdue: number;
    last_reminded: string | null;
    acknowledged_at: string | null;
    last_acknowledgment_reminder: string | null;
    acknowledgment_reminder_count: number;
    can_remind_acknowledgment: number;
  }[];
};
export default function PerformanceCycles({
  context,
  onAssigned,
  reviewState,
}: {
  context: Context;
  onAssigned: () => Promise<void>;
  reviewState: string;
}) {
  const [cycles, setCycles] = useState<Cycle[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const data = await api("performance");
    setCycles(data.cycles);
  }
  useEffect(() => {
    let active = true;
    api("performance")
      .then((data) => {
        if (active) setCycles(data.cycles);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [reviewState]);
  async function save(body: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api("performance", body);
      setMessage(
        result.summary_id !== undefined
          ? result.reused
            ? "The current completion summary is already saved."
            : "Completion summary saved."
          : result.acknowledgment_reminders
            ? `${result.sent} acknowledgment reminders sent; ${result.skipped} already reminded today; ${result.unavailable} employees unavailable.`
            : result.reassigned
              ? "Reviewer reassigned. Existing response and status preserved."
              : result.sent !== undefined
                ? `${result.sent} reminders sent; ${result.skipped} already reminded today.`
                : result.assigned === undefined
                  ? "Cycle saved."
                  : `${result.assigned} reviews assigned; ${result.skipped} already assigned employees skipped.`,
      );
      await load();
      await onAssigned();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save cycle.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel ops-form">
      <h2>Review cycles</h2>
      <p>
        Create a cycle, then assign a reviewer to selected employees. Each
        employee receives one review per cycle. Review responses stay private
        until HR publishes them.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const values = Object.fromEntries(new FormData(e.currentTarget));
          void save({ action: "create", ...values });
        }}
      >
        <div className="ops-form-grid">
          <label>
            Cycle title
            <input name="title" required maxLength={500} />
          </label>
          <label>
            Cycle start
            <input name="start" type="date" required />
          </label>
          <label>
            Cycle due date
            <input name="due" type="date" required />
          </label>
        </div>
        <button className="primary" disabled={busy}>
          Create cycle
        </button>
      </form>
      <button
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setError("");
          try {
            await load();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Unable to refresh cycles.",
            );
          }
        }}
      >
        Refresh review progress
      </button>
      <p>
        Overdue means a draft response is past its due date in Lagos time.
        Reminders go to active reviewers in the app, once per review each day.
      </p>
      {cycles.map((cycle) => (
        <article key={cycle.id} className="ops-record">
          <h3>
            {cycle.title} · {cycle.status}
          </h3>
          <p>
            {cycle.start} to {cycle.due} · {cycle.assigned} assigned ·{" "}
            {cycle.submitted} awaiting publication · {cycle.published} published
            · {cycle.pending} pending · {cycle.overdue} overdue ·{" "}
            {cycle.acknowledged} acknowledged · {cycle.awaiting_acknowledgment}{" "}
            awaiting acknowledgment
          </p>
          {cycle.status === "Closed" && (
            <details>
              <summary>Completion summaries · {cycle.title}</summary>
              <p>
                Save a dated snapshot of published reviews, acknowledgment
                receipts and outstanding follow-up. Saved summaries stay
                unchanged as new receipts arrive.
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void save({ action: "summarize", cycle_id: cycle.id })
                }
              >
                Save completion summary
              </button>
              {cycle.summaries.map((summary) => (
                <article key={summary.id}>
                  <p>
                    Summary #{summary.id} · {dateTime(summary.created)}
                  </p>
                  <p>
                    {summary.snapshot.totals.assigned} published ·{" "}
                    {summary.snapshot.totals.acknowledged} acknowledged ·{" "}
                    {summary.snapshot.totals.awaiting_acknowledgment} awaiting
                    acknowledgment ·{" "}
                    {summary.snapshot.totals.unavailable_for_followup}{" "}
                    unavailable for follow-up
                  </p>
                  <p>
                    Acknowledgment completion:{" "}
                    {summary.snapshot.totals.acknowledgment_percent === null
                      ? "No assignments"
                      : `${summary.snapshot.totals.acknowledgment_percent}%`}
                  </p>
                  <a href={`/api/performance-summaries?id=${summary.id}`}>
                    Download completion summary #{summary.id}
                  </a>
                </article>
              ))}
              {!cycle.summaries.length && (
                <p>No completion summaries saved yet.</p>
              )}
            </details>
          )}
          <button
            className="secondary"
            disabled={busy || !cycle.awaiting_acknowledgment}
            aria-label={`Remind unacknowledged employees · ${cycle.title}`}
            onClick={() =>
              void save({
                action: "remind_acknowledgments",
                cycle_id: cycle.id,
              })
            }
          >
            Remind unacknowledged employees
          </button>
          <details>
            <summary>Assignment progress · {cycle.title}</summary>
            {cycle.assignments.length ? (
              <div className="ops-table">
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Reviewer</th>
                      <th>Status</th>
                      <th>Due</th>
                      <th>Last reminder (Lagos)</th>
                      <th>Employee acknowledgment</th>
                      <th>Acknowledgment follow-up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycle.assignments.map((row) => (
                      <tr key={row.id}>
                        <td>{row.employee_name}</td>
                        <td>{row.reviewer_name}</td>
                        <td>
                          {row.status}
                          {row.overdue ? " · Overdue" : ""}
                        </td>
                        <td>{row.due || "No due date"}</td>
                        <td>{row.last_reminded || "Never"}</td>
                        <td>
                          {row.acknowledged_at
                            ? dateTime(row.acknowledged_at)
                            : row.status === "Published"
                              ? "Awaiting acknowledgment"
                              : "Available after publication"}
                        </td>
                        <td>
                          {row.acknowledged_at ? (
                            "Received"
                          ) : row.status !== "Published" ? (
                            "Available after publication"
                          ) : (
                            <>
                              {row.last_acknowledgment_reminder
                                ? `Last reminded ${row.last_acknowledgment_reminder} · ${row.acknowledgment_reminder_count} sent`
                                : "Never reminded"}
                              {!row.can_remind_acknowledgment &&
                                " · Employee unavailable"}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No assignments yet.</p>
            )}
            {cycle.assignments.map((row) => (
              <section key={`${row.id}:${row.revision}`}>
                {cycle.status === "Open" && row.status !== "Published" && (
                  <details>
                    <summary>Reassign reviewer · {row.employee_name}</summary>
                    <p>
                      Current reviewer: {row.reviewer_name}. The saved response,
                      rating, status and due date will be preserved. The
                      replacement receives access immediately.
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const values = new FormData(e.currentTarget);
                        void save({
                          action: "reassign",
                          cycle_id: cycle.id,
                          record_id: row.id,
                          revision: row.revision,
                          reviewer_id: Number(values.get("reviewer_id")),
                          reason: values.get("reason"),
                        });
                      }}
                    >
                      <label>
                        Replacement reviewer
                        <select
                          aria-label={`Replacement reviewer · ${row.employee_name}`}
                          name="reviewer_id"
                          required
                          defaultValue=""
                        >
                          <option value="">Choose reviewer…</option>
                          {context.employees
                            .filter(
                              (p) =>
                                p.status === "Active" &&
                                p.account_access &&
                                p.id !== row.employee_id &&
                                p.id !== row.reviewer_id,
                            )
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Reassignment reason
                        <textarea
                          aria-label={`Reassignment reason · ${row.employee_name}`}
                          name="reason"
                          required
                          maxLength={2000}
                        />
                      </label>
                      <button className="primary" disabled={busy}>
                        Reassign reviewer
                      </button>
                    </form>
                  </details>
                )}
                {!!row.history.length && (
                  <details>
                    <summary>
                      Reassignment history · {row.employee_name}
                    </summary>
                    {row.history.map((event) => {
                      const before = JSON.parse(event.snapshot);
                      const data = JSON.parse(before.data);
                      return (
                        <article key={event.id}>
                          <p>
                            {event.from_name} → {event.to_name} ·{" "}
                            {event.actor_name} · {dateTime(event.created)}
                          </p>
                          <p className="preserve-lines">
                            Reason: {event.reason}
                          </p>
                          <p>
                            Preserved status: {before.status} · Rating:{" "}
                            {data.rating || "Not rated"}
                          </p>
                          <p className="preserve-lines">
                            {before.body ||
                              "No response saved at reassignment."}
                          </p>
                        </article>
                      );
                    })}
                  </details>
                )}
              </section>
            ))}
          </details>
          {cycle.status === "Open" && (
            <>
              <button
                className="secondary"
                disabled={busy || !cycle.pending}
                aria-label={`Remind pending reviewers · ${cycle.title}`}
                onClick={() =>
                  void save({ action: "remind", cycle_id: cycle.id })
                }
              >
                Remind pending reviewers
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const values = new FormData(e.currentTarget);
                  void save({
                    action: "assign",
                    cycle_id: cycle.id,
                    reviewer_id: Number(values.get("reviewer_id")),
                    employee_ids: values.getAll("employee_ids").map(Number),
                  });
                }}
              >
                <label>
                  Cycle reviewer
                  <select
                    aria-label="Cycle reviewer"
                    name="reviewer_id"
                    required
                    defaultValue=""
                  >
                    <option value="">Choose reviewer…</option>
                    {context.peers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset disabled={busy}>
                  <legend>Employees to review (up to 200)</legend>
                  {context.employees
                    .filter((p) => p.status === "Active")
                    .map((p) => (
                      <label className="ops-check" key={p.id}>
                        <input
                          type="checkbox"
                          name="employee_ids"
                          value={p.id}
                        />
                        {p.name}
                      </label>
                    ))}
                </fieldset>
                <button className="primary" disabled={busy}>
                  Assign selected employees
                </button>
              </form>
              <button
                className="secondary"
                disabled={busy || cycle.assigned !== cycle.published}
                onClick={() =>
                  void save({ action: "close", cycle_id: cycle.id })
                }
              >
                Close cycle
              </button>
            </>
          )}
        </article>
      ))}
      {!cycles.length && <p>No review cycles yet.</p>}
    </section>
  );
}
