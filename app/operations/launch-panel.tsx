"use client";
import { useEffect, useState } from "react";
import { api } from "./types";
type Launch = {
  period: string;
  completed: number;
  total: number;
  next: string | null;
  missing_compensation: { id: number; name: string }[];
  steps: {
    id: string;
    title: string;
    complete: boolean;
    detail: string;
    tab: string;
  }[];
};
export default function LaunchPanel() {
  const [period, setPeriod] = useState(""),
    [data, setData] = useState<Launch | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    api(`launch${period ? `?period=${encodeURIComponent(period)}` : ""}`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [period, revision]);
  return (
    <>
      <section className="panel ops-form">
        <h2>Your first payroll checklist</h2>
        <p>
          Work toward your first reviewed payroll within 24 hours. Progress
          follows your company’s saved records and the selected month; it does
          not guarantee payroll accuracy.
        </p>
        <label>
          Payroll month
          <input
            type="month"
            min="2026-01"
            max="2026-12"
            value={period || data?.period || ""}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </label>
        <button className="secondary" onClick={() => setRevision((v) => v + 1)}>
          Refresh checklist
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!data && !error && <p role="status">Loading setup progress…</p>}
        {data && (
          <>
            <p role="status">
              {data.completed} of {data.total} steps complete for {data.period}
            </p>
            <progress
              aria-label="Company setup progress"
              value={data.completed}
              max={data.total}
            />
            <p>
              <a href="/payroll-review.xlsx">
                Download calculation review workbook
              </a>
            </p>
          </>
        )}
      </section>
      {data && (
        <div className="ops-cards">
          {data.steps.map((step) => (
            <section className="panel ops-record" key={step.id}>
              <p>
                {step.complete
                  ? "Complete"
                  : data.next === step.id
                    ? "Next step"
                    : "To do"}
              </p>
              <h2>{step.title}</h2>
              <p>{step.detail}</p>
              {step.id === "compensation" &&
                data.missing_compensation.length > 0 && (
                  <details>
                    <summary>
                      Staff missing compensation (
                      {data.missing_compensation.length})
                    </summary>
                    <ul>
                      {data.missing_compensation.map((p) => (
                        <li key={p.id}>{p.name}</li>
                      ))}
                    </ul>
                  </details>
                )}
              <a className="secondary" href={`/operations?tab=${step.tab}`}>
                {step.tab === "import"
                  ? "Open staff import"
                  : "Open payroll & payslips"}
              </a>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
