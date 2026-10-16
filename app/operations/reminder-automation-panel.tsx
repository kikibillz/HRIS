"use client";
import { useEffect, useState } from "react";
import { api, dateTime } from "./types";
type Monitor = {
  settings: { enabled: number; hour: number };
  worker: { last_tick: string; last_error: string; healthy: boolean } | null;
  runs: {
    day: string;
    status: string;
    sent: number;
    skipped: number;
    error: string;
  }[];
  deliveries: {
    id: number;
    name: string;
    title: string;
    day: string;
    source: string;
    created: string;
    read_at: string | null;
  }[];
};
export default function ReminderAutomationPanel() {
  const [data, setData] = useState<Monitor | null>(null),
    [enabled, setEnabled] = useState(false),
    [hour, setHour] = useState(9),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    api("reminder-automation")
      .then((result) => {
        if (active) {
          setData(result);
          setEnabled(!!result.settings.enabled);
          setHour(result.settings.hour);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  return (
    <>
      <section className="panel ops-form">
        <h2>Daily onboarding reminders</h2>
        <p>
          Automatic reminders are opt-in for this company. The worker checks
          every minute and runs once per Lagos day at or after the selected
          hour. Missed days are not replayed. Manual and automatic reminders
          share the daily duplicate limit.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="ops-success">
            {message}
          </p>
        )}
        {data ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setMessage("");
              try {
                await api("reminder-automation", { enabled, hour });
                setMessage("Reminder schedule saved.");
                setRevision((v) => v + 1);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Unable to save.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="ops-check">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Enable automatic in-app reminders
            </label>
            <label>
              Daily Lagos hour
              <select
                aria-label="Daily Lagos hour"
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, "0")}:00 WAT
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" disabled={busy}>
              Save reminder schedule
            </button>
          </form>
        ) : (
          <p>Loading reminder settings…</p>
        )}
      </section>
      {data && (
        <>
          <section className="panel ops-form">
            <h2>Worker and delivery monitor</h2>
            <p>
              {data.worker?.healthy
                ? "Worker heartbeat is recent."
                : "Worker heartbeat is missing or stale. Check the production worker before relying on automatic reminders."}
            </p>
            {data.worker && (
              <p>
                Last heartbeat: {dateTime(data.worker.last_tick)}{" "}
                {data.worker.last_error}
              </p>
            )}
            <p>
              Delivery means a notification was created in the employee’s inbox.
              Marked read reflects the employee’s action; it is not proof of
              email delivery. Latest 30 job days and 100 recorded notifications.
              Reminders from before this monitor was added remain in the audit
              log.
            </p>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setError("");
                setRevision((v) => v + 1);
              }}
            >
              Refresh delivery monitor
            </button>
          </section>
          <div className="ops-cards">
            {data.runs.map((run) => (
              <section className="panel ops-record" key={run.day}>
                <h2>
                  {run.day} · {run.status}
                </h2>
                <p>
                  {run.sent} created · {run.skipped} checklists skipped (not
                  overdue or already reminded)
                </p>
                {run.error && <p role="alert">{run.error}</p>}
              </section>
            ))}
          </div>
          <section className="panel ops-form">
            <h2>Recorded notifications</h2>
            {!data.deliveries.length && (
              <p>No recorded reminder deliveries yet.</p>
            )}
            {data.deliveries.map((d) => (
              <div key={d.id}>
                <h3>
                  {d.name} · {d.title}
                </h3>
                <p>
                  {d.source} · Created {dateTime(d.created)} ·{" "}
                  {d.read_at
                    ? `Marked read ${dateTime(d.read_at)}`
                    : "Not marked read"}
                </p>
              </div>
            ))}
          </section>
        </>
      )}
    </>
  );
}
