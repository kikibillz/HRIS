"use client";
import { useEffect, useState } from "react";
import { api, type Context } from "./types";
type Cycle = {
  id: number;
  title: string;
  start: string;
  due: string;
  status: string;
  assigned: number;
  submitted: number;
  published: number;
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
        result.assigned === undefined
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
      {cycles.map((cycle) => (
        <article key={cycle.id} className="ops-record">
          <h3>
            {cycle.title} · {cycle.status}
          </h3>
          <p>
            {cycle.start} to {cycle.due} · {cycle.assigned} assigned ·{" "}
            {cycle.submitted} awaiting publication · {cycle.published} published
          </p>
          {cycle.status === "Open" && (
            <>
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
