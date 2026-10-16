"use client";
import { useEffect, useState } from "react";
import { api } from "./types";
type Assignment = {
  id: number;
  name: string;
  title: string;
  start_date: string;
  total: number;
  completed: number;
  overdue: number;
  next_due: string | null;
};
export default function OnboardingProgressPanel() {
  const [rows, setRows] = useState<Assignment[]>([]),
    [today, setToday] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    api("onboarding-progress")
      .then((result) => {
        if (active) {
          setRows(result.assignments);
          setToday(result.today);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  async function remind(id: number) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api("onboarding-progress", {
        action: "remind",
        assignment_id: id,
      });
      setMessage(result.reason);
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to send reminder.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel ops-form">
        <h2>Starter progress and overdue tasks</h2>
        <p>
          Managers see active employees assigned to them; administrators see
          their company. Latest 100 checklists. Due dates are evaluated in
          Africa/Lagos: {today || "loading…"}. A task becomes overdue the day
          after its due date.
        </p>
        <p>
          Send an in-app reminder for open overdue tasks. Each checklist can
          receive one reminder per day, shared across HR and managers.
        </p>
        <div className="ops-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setRevision((v) => v + 1)}
          >
            Refresh onboarding progress
          </button>
          <a href="/operations?tab=tasks">Open onboarding tasks</a>
        </div>
      </section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="ops-success">
          {message}
        </p>
      )}
      {!today && !error && <p>Loading onboarding progress…</p>}
      {today && rows.length === 0 && (
        <p>No checklists for your active employees.</p>
      )}
      <div className="ops-cards">
        {rows.map((row) => (
          <section className="panel ops-record" key={row.id}>
            <h2>
              {row.name} · {row.title}
            </h2>
            <p>Start {row.start_date}</p>
            <p>
              {row.completed} of {row.total} tasks complete · {row.overdue}{" "}
              overdue
            </p>
            <progress
              aria-label={`${row.name}: completion`}
              value={row.completed}
              max={row.total || 1}
            />
            {row.next_due && <p>Earliest open due date: {row.next_due}</p>}
            <button
              className="secondary"
              disabled={busy || !row.overdue}
              onClick={() => void remind(row.id)}
            >
              Send reminder to {row.name}
            </button>
          </section>
        ))}
      </div>
    </>
  );
}
