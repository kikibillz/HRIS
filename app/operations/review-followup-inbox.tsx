"use client";
import { useEffect, useState } from "react";
import ReviewFollowupBulk from "./review-followup-bulk";
import ReviewFollowupBatchHistory, {
  type FollowupBatch,
} from "./review-followup-batch-history";
import { api, dateTime, type Context } from "./types";
type WorkloadSummary = {
  id: number;
  created: string;
  as_of_day: string;
  totals: {
    total: number;
    open: number;
    resolved: number;
    overdue: number;
    unassigned: number;
    unavailable_owner: number;
    needs_hr_owner: number;
    due_today: number;
    without_due: number;
  };
};
type Item = {
  id: number;
  record_id: number;
  employee_name: string;
  review_title: string;
  question: string;
  status: string;
  created: string;
  resolution_note: string | null;
  resolved_at: string | null;
  owner_id: number | null;
  owner_name: string | null;
  owner_unavailable: number;
  due: string;
  version: number;
  overdue: number;
  needs_escalation: number;
  alerts: {
    id: number;
    kind: string;
    day: string;
    reason: string;
    created: string;
    recipients: number;
  }[];
  history: {
    id: number;
    reason: string;
    created: string;
    before_snapshot: string;
    after_snapshot: string;
  }[];
};
export default function ReviewFollowupInbox({ context }: { context: Context }) {
  const [requests, setRequests] = useState<Item[]>([]),
    [batches, setBatches] = useState<FollowupBatch[]>([]),
    [summaries, setSummaries] = useState<WorkloadSummary[]>([]),
    [owners, setOwners] = useState<{ id: number; name: string }[]>([]),
    [status, setStatus] = useState("Open"),
    [ownerFilter, setOwnerFilter] = useState("all"),
    [overdueOnly, setOverdueOnly] = useState(false),
    [escalationsOnly, setEscalationsOnly] = useState(false),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    const data = await api("review-followup-inbox");
    setRequests(data.requests);
    setOwners(data.owners);
    setSummaries(data.summaries);
    setBatches(data.batches);
  }
  useEffect(() => {
    let active = true;
    api("review-followup-inbox")
      .then((data) => {
        if (active) {
          setRequests(data.requests);
          setOwners(data.owners);
          setSummaries(data.summaries);
          setBatches(data.batches);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function save(body: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api("review-followups", body);
      await load();
      setMessage(
        result.alert
          ? result.already_sent
            ? "Already sent today. No duplicate notification created."
            : `${result.sent} HR notifications sent.`
          : "Follow-up updated.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update follow-up.");
    } finally {
      setBusy(false);
    }
  }
  async function saveSummary() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api("review-followup-summaries", {});
      await load();
      setMessage(
        result.reused
          ? "The current workload summary is already saved."
          : "Workload summary saved.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to save workload summary.",
      );
    } finally {
      setBusy(false);
    }
  }
  const filtered = requests.filter(
    (row) =>
      (status === "All" || row.status === status) &&
      (ownerFilter === "all" ||
        (ownerFilter === "mine"
          ? row.owner_id === context.user.id
          : row.owner_id === null)) &&
      (!overdueOnly || !!row.overdue) &&
      (!escalationsOnly || !!row.needs_escalation) &&
      `${row.employee_name} ${row.review_title} ${row.question}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <section className="panel ops-form">
        <h2>Saved workload summaries</h2>
        <p>
          Save all company review follow-ups, regardless of the current inbox
          filters. Each dated snapshot preserves ownership, due dates and
          delivery counts. Private question and HR response text are excluded.
        </p>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void saveSummary()}
        >
          Save workload summary
        </button>
        <details>
          <summary>Workload summary history</summary>
          {summaries.map((summary) => (
            <article key={summary.id}>
              <p>
                Summary #{summary.id} · {dateTime(summary.created)} · As of{" "}
                {summary.as_of_day} (Lagos)
              </p>
              <p>
                {summary.totals.open} open · {summary.totals.overdue} overdue ·{" "}
                {summary.totals.needs_hr_owner} need an HR owner ·{" "}
                {summary.totals.resolved} resolved
              </p>
              <a href={`/api/review-followup-summaries?id=${summary.id}`}>
                Download workload summary #{summary.id}
              </a>
            </article>
          ))}
          {!summaries.length && <p>No workload summaries saved yet.</p>}
        </details>
      </section>
      <div className="ops-toolbar">
        <label>
          Request status
          <select
            aria-label="Request status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option>Open</option>
            <option>Resolved</option>
            <option>All</option>
          </select>
        </label>
        <label>
          Ownership
          <select
            aria-label="Ownership"
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
          >
            <option value="all">All owners</option>
            <option value="mine">My assignments</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </label>
        <label>
          Search follow-ups
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="ops-check">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
          />
          Overdue only
        </label>
        <label className="ops-check">
          <input
            type="checkbox"
            checked={escalationsOnly}
            onChange={(e) => setEscalationsOnly(e.target.checked)}
          />
          Needs HR owner
        </label>
        <button
          className="secondary"
          disabled={busy}
          onClick={async () => {
            setError("");
            try {
              await load();
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Unable to refresh inbox.",
              );
            }
          }}
        >
          Refresh follow-up inbox
        </button>
      </div>
      <p role="status">
        {requests.filter((row) => row.status === "Open").length} open ·{" "}
        {
          requests.filter(
            (row) => row.status === "Open" && row.owner_id === null,
          ).length
        }{" "}
        unassigned · {requests.filter((row) => row.overdue).length} overdue ·{" "}
        {requests.filter((row) => row.needs_escalation).length} need an HR owner
        · {filtered.length} shown
      </p>
      <p>
        Due dates use Lagos calendar dates. Ownership helps HR coordinate work;
        access continues to follow company roles. Owner reminders and
        escalations are manual in-app notifications, limited to one of each per
        request per Lagos day.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <ReviewFollowupBulk
        key={JSON.stringify([
          status,
          ownerFilter,
          overdueOnly,
          escalationsOnly,
          search,
        ])}
        rows={filtered}
        owners={owners}
        onSaved={load}
      />
      <ReviewFollowupBatchHistory batches={batches} />
      {filtered.map((row) => (
        <article className="panel ops-form" key={row.id}>
          <h2>
            Follow-up #{row.id} · {row.employee_name}
          </h2>
          <p>
            {row.review_title} · {row.status} · {dateTime(row.created)}
          </p>
          <p className="preserve-lines">{row.question}</p>
          <p>
            Owner: {row.owner_name || "Unassigned"}
            {row.owner_unavailable ? " · Owner unavailable" : ""} · Due:{" "}
            {row.due || "Not set"}
            {row.overdue ? " · Overdue" : ""}
          </p>
          <a href="/operations?tab=reviews">Open performance reviews</a>
          {row.status === "Open" ? (
            <>
              {!!row.overdue &&
                row.owner_id !== null &&
                !row.owner_unavailable && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void save({
                        action: "remind_owner",
                        request_id: row.id,
                        expected_version: row.version,
                      })
                    }
                  >
                    Remind overdue HR owner
                  </button>
                )}
              {!!row.needs_escalation && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save({
                      action: "escalate",
                      request_id: row.id,
                      expected_version: row.version,
                      reason: new FormData(e.currentTarget).get("reason"),
                    });
                  }}
                >
                  <p>
                    This open follow-up needs an available HR owner. Notify
                    active HR administrators to arrange reassignment.
                  </p>
                  <label>
                    Escalation reason
                    <textarea name="reason" required maxLength={2000} />
                  </label>
                  <button className="secondary" disabled={busy}>
                    Escalate to HR
                  </button>
                </form>
              )}

              <details>
                <summary>Assign owner and due date</summary>
                <form
                  key={row.version}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const values = new FormData(e.currentTarget);
                    void save({
                      action: "assign",
                      request_id: row.id,
                      expected_version: row.version,
                      owner_id: values.get("owner_id")
                        ? Number(values.get("owner_id"))
                        : null,
                      due: values.get("due"),
                      reason: values.get("reason"),
                    });
                  }}
                >
                  <label>
                    HR owner
                    <select
                      aria-label={`HR owner · Follow-up #${row.id}`}
                      name="owner_id"
                      defaultValue={row.owner_id ?? ""}
                    >
                      <option value="">Unassigned</option>
                      {row.owner_unavailable && (
                        <option value={row.owner_id!} disabled>
                          {row.owner_name} (unavailable)
                        </option>
                      )}
                      {owners.map((owner) => (
                        <option key={owner.id} value={owner.id}>
                          {owner.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Follow-up due date
                    <input type="date" name="due" defaultValue={row.due} />
                  </label>
                  <label>
                    Assignment reason
                    <textarea name="reason" required maxLength={2000} />
                  </label>
                  <button className="primary" disabled={busy}>
                    Save owner and due date
                  </button>
                </form>
              </details>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save({
                    action: "resolve",
                    request_id: row.id,
                    note: new FormData(e.currentTarget).get("note"),
                  });
                }}
              >
                <label>
                  HR response
                  <textarea name="note" required maxLength={4000} />
                </label>
                <p>Your final response will be shared with the employee.</p>
                <button className="primary" disabled={busy}>
                  Record response and resolve
                </button>
              </form>
            </>
          ) : (
            <>
              <p>Resolved {row.resolved_at && dateTime(row.resolved_at)}</p>
              <p className="preserve-lines">{row.resolution_note}</p>
            </>
          )}
          {!!row.alerts.length && (
            <details>
              <summary>Reminder and escalation history</summary>
              {row.alerts.map((alert) => (
                <article key={alert.id}>
                  <p>
                    {alert.kind === "owner_reminder"
                      ? "Owner reminder"
                      : "Escalation"}{" "}
                    · {dateTime(alert.created)} · {alert.recipients} HR
                    recipients
                  </p>
                  <p className="preserve-lines">{alert.reason}</p>
                </article>
              ))}
            </details>
          )}
          {!!row.history.length && (
            <details>
              <summary>Assignment history</summary>
              {row.history.map((event) => {
                const before = JSON.parse(event.before_snapshot),
                  after = JSON.parse(event.after_snapshot);
                return (
                  <article key={event.id}>
                    <p>
                      {dateTime(event.created)} ·{" "}
                      {before.owner_name || "Unassigned"} →{" "}
                      {after.owner_name || "Unassigned"} · Due{" "}
                      {before.due || "not set"} → {after.due || "not set"}
                    </p>
                    <p className="preserve-lines">{event.reason}</p>
                  </article>
                );
              })}
            </details>
          )}
        </article>
      ))}
      {!filtered.length && <p>No follow-ups match these filters.</p>}
    </>
  );
}
