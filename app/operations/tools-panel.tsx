"use client";
import { useEffect, useState } from "react";
import { api, amount, dateTime, type Context } from "./types";
type Data = { rows: Record<string, unknown>[]; [key: string]: unknown };
function Table({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p className="ops-empty">No records yet.</p>;
  const keys = Object.keys(rows[0]);
  return (
    <div className="ops-table">
      <table>
        <thead>
          <tr>
            {keys.map((k) => (
              <th key={k}>{k.replaceAll("_", " ")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {keys.map((k) => (
                <td key={k}>
                  {typeof r[k] === "number"
                    ? Number.isInteger(r[k])
                      ? String(r[k])
                      : Number(r[k]).toFixed(2)
                    : String(r[k] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export default function ToolsPanel({
  kind,
  context,
}: {
  kind: string;
  context: Context;
}) {
  const admin = context.user.access === "admin",
    [data, setData] = useState<Data>({ rows: [] }),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [csv, setCsv] = useState(""),
    [preview, setPreview] = useState<{
      count: number;
      rows: (Record<string, unknown> | null)[];
      errors: { row: number; error: string }[];
    } | null>(null),
    [answer, setAnswer] = useState<{
      answer: string;
      mode: string;
      sources: { id: number; title: string; excerpt: string }[];
    } | null>(null),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const endpoint =
    kind === "analytics"
      ? "reports"
      : kind === "audit"
        ? "reports?type=audit"
        : kind;
  async function load() {
    if (["import", "assistant", "people"].includes(kind)) return;
    try {
      setData(await api(endpoint));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load.");
    }
  }
  useEffect(() => {
    setError("");
    setMessage("");
    setData({ rows: [] });
    void load();
  }, [kind]);
  async function perform(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage("Saved successfully.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }
  const employees = (
    <>
      {context.employees.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </>
  );
  return (
    <>
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
      {kind === "people" && (
        <div className="ops-cards">
          {context.employees.map((person) => (
            <section className="panel ops-form" key={person.id}>
              <h2>{person.name}</h2>
              <p>
                {person.email} · {person.department}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const b = Object.fromEntries(new FormData(e.currentTarget));
                  void perform(async () => {
                    await api(
                      "people",
                      { ...b, employee_id: person.id },
                      "PATCH",
                    );
                    window.location.reload();
                  });
                }}
              >
                <label>
                  Name
                  <input
                    name="name"
                    required
                    defaultValue={person.name}
                    maxLength={120}
                  />
                </label>
                <label>
                  Job title
                  <input
                    name="role"
                    required
                    defaultValue={person.role}
                    maxLength={120}
                  />
                </label>
                <label>
                  Joined date
                  <input
                    name="joined"
                    type="date"
                    required
                    defaultValue={person.joined}
                  />
                </label>
                <label>
                  Employment status
                  <select name="status" defaultValue={person.status}>
                    <option>Active</option>
                    <option>Inactive</option>
                  </select>
                </label>
                {person.account_access && person.account_access !== "admin" && (
                  <label>
                    Account role
                    <select name="access" defaultValue={person.account_access}>
                      <option value="employee">Employee</option>
                      <option value="manager">Manager</option>
                    </select>
                  </label>
                )}
                <p>
                  Saving an account change signs this employee out. Deactivation
                  preserves their records.
                </p>
                <button className="primary" disabled={busy}>
                  Save employee record
                </button>
              </form>
            </section>
          ))}
        </div>
      )}
      {kind === "import" && (
        <section className="panel ops-form">
          <h2>Import your staff list</h2>
          <p>
            Upload UTF-8 CSV with name, email, role, department, and joined
            (YYYY-MM-DD). Include monthly basic, housing, transport, other,
            pension (true/false), and nhf (true/false) to prepare compensation
            in the same import. Existing staff are never overwritten.
          </p>
          <a href="/staff-import-template.csv" download>
            Download CSV template
          </a>
          <label>
            Staff CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setCsv(await file.text());
                  setPreview(null);
                }
              }}
            />
          </label>
          <button
            className="secondary"
            disabled={!csv || busy}
            onClick={() =>
              void perform(async () =>
                setPreview(await api("import", { csv, action: "preview" })),
              )
            }
          >
            Preview and validate
          </button>
          {preview && (
            <>
              <p>
                {preview.count} staff rows · {preview.errors.length} errors
              </p>
              <p>Preview of the first {Math.min(preview.count, 100)} rows:</p>
              <Table
                rows={preview.rows
                  .filter((r): r is Record<string, unknown> => !!r)
                  .slice(0, 100)
                  .map((r) => ({
                    name: r.name,
                    email: r.email,
                    role: r.role,
                    department: r.department,
                    joined: r.joined,
                    basic: r.salary
                      ? amount((r.salary as { basic: number }).basic)
                      : "Not provided",
                  }))}
              />
              {preview.errors.length > 0 ? (
                <Table rows={preview.errors} />
              ) : (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await api("import", { csv, action: "commit" });
                      setCsv("");
                      setPreview(null);
                      window.location.reload();
                    })
                  }
                >
                  Import validated staff
                </button>
              )}
            </>
          )}
        </section>
      )}
      {kind === "attendance" && (
        <>
          <section className="panel ops-form">
            <h2>Clock in from this device</h2>
            <p>
              No app install needed. Times use the server clock; display
              timezone is WAT.
            </p>
            <p>
              {data.rows.some(
                (r) =>
                  r.employee_id === context.user.employee_id && !r.clock_out,
              )
                ? "You are currently clocked in."
                : "You are currently clocked out."}
            </p>
            <div className="ops-actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void perform(() => api("attendance", { action: "in" }))
                }
              >
                Clock in
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void perform(() => api("attendance", { action: "out" }))
                }
              >
                Clock out
              </button>
            </div>
          </section>
          <section className="panel ops-form">
            <h2>Attendance history</h2>
            <Table
              rows={data.rows.map((r) => ({
                employee: r.name,
                clock_in: dateTime(String(r.clock_in)),
                clock_out: r.clock_out
                  ? dateTime(String(r.clock_out))
                  : "On shift",
                hours: r.clock_out
                  ? (Date.parse(String(r.clock_out)) -
                      Date.parse(String(r.clock_in))) /
                    3600000
                  : null,
              }))}
            />
          </section>
        </>
      )}
      {kind === "documents" && (
        <>
          <section className="panel ops-form">
            <h2>Upload a document</h2>
            <p>
              PDF, DOCX, TXT, PNG, or JPEG. Up to 5 MB per file and 50 MB per
              company. Private documents are visible to their employee and HR.
              Files are downloaded as attachments.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void perform(async () => {
                  const r = await fetch("/api/documents", {
                    method: "POST",
                    body: form,
                  });
                  const b = await r.json();
                  if (!r.ok) throw Error(b.error);
                });
              }}
            >
              {admin && (
                <label>
                  Document audience
                  <select name="employee_id">
                    <option value="">Everyone in this company</option>
                    {employees}
                  </select>
                </label>
              )}
              <label>
                Document file
                <input
                  type="file"
                  name="file"
                  required
                  accept=".pdf,.docx,.txt,.png,.jpg,.jpeg"
                />
              </label>
              <button className="primary" disabled={busy}>
                Upload document
              </button>
            </form>
          </section>
          <div className="ops-cards">
            {data.rows.map((r) => (
              <article className="panel ops-record" key={Number(r.id)}>
                <h2>{String(r.name)}</h2>
                <p>
                  {Math.ceil(Number(r.size) / 1024)} KB ·{" "}
                  {r.employee_id ? "Employee document" : "Company document"}
                </p>
                <a className="secondary" href={`/api/documents/${r.id}`}>
                  Download
                </a>
                {admin && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void perform(() => api(`documents/${r.id}`, {}, "DELETE"))
                    }
                  >
                    Delete document
                  </button>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      {kind === "notifications" && (
        <>
          {admin && (
            <section className="panel ops-form">
              <h2>Send an in-app notification</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const b = Object.fromEntries(new FormData(e.currentTarget));
                  void perform(() =>
                    api("notifications", {
                      ...b,
                      employee_id: Number(b.employee_id),
                    }),
                  );
                }}
              >
                <label>
                  Employee
                  <select name="employee_id" required>
                    {employees}
                  </select>
                </label>
                <label>
                  Title
                  <input name="title" required maxLength={120} />
                </label>
                <label>
                  Message
                  <textarea name="body" required maxLength={2000} />
                </label>
                <button className="primary" disabled={busy}>
                  Send notification
                </button>
              </form>
            </section>
          )}
          <div className="ops-cards">
            {data.rows.map((r) => (
              <article className="panel ops-record" key={Number(r.id)}>
                <h2>{String(r.title)}</h2>
                <p>{String(r.body)}</p>
                <small>{dateTime(String(r.created))}</small>
                {!r.read_at && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void perform(() =>
                        api("notifications", { id: r.id }, "PATCH"),
                      )
                    }
                  >
                    Mark as read
                  </button>
                )}
              </article>
            ))}
          </div>
          {!data.rows.length && (
            <p className="ops-empty">No notifications yet.</p>
          )}
        </>
      )}
      {kind === "assistant" && (
        <section className="panel ops-form">
          <h2>Ask about your company policies</h2>
          <p>
            {context.ai_configured
              ? "Answers use published company policies, with source passages for checking."
              : "AI answers are not enabled. You can search published policies and read the matching passages here."}{" "}
            The assistant cannot change records, make payroll decisions, or
            access private employee files.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const question = new FormData(e.currentTarget).get("question");
              void perform(async () =>
                setAnswer(await api("policy-assistant", { question })),
              );
            }}
          >
            <label>
              Your policy question
              <textarea name="question" required maxLength={1000} />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "Searching…" : "Ask policy assistant"}
            </button>
          </form>
          {answer && (
            <div className="ops-answer">
              <span className="dept-tag">{answer.mode}</span>
              <p className="preserve-lines">{answer.answer}</p>
              {answer.sources.map((s) => (
                <details key={s.id} open>
                  <summary>{s.title}</summary>
                  <p className="preserve-lines">{s.excerpt}</p>
                </details>
              ))}
            </div>
          )}
        </section>
      )}
      {kind === "audit" && (
        <>
          <section className="panel ops-form">
            <h2>Company activity · latest 1,000 events</h2>
            <Table rows={data.rows} />
          </section>
          <section className="panel ops-form">
            <h2>Account security · latest 300 events</h2>
            <Table rows={(data.security ?? []) as Record<string, unknown>[]} />
          </section>
          <section className="panel ops-form">
            <h2>Leave decisions · latest 300 events</h2>
            <Table rows={(data.leave ?? []) as Record<string, unknown>[]} />
          </section>
        </>
      )}
      {kind === "analytics" && (
        <>
          <div className="stats">
            {Object.entries((data.counts ?? {}) as Record<string, number>).map(
              ([k, v]) => (
                <section className="stat" key={k}>
                  <small>
                    {k === "staff"
                      ? "Company staff"
                      : k === "compensation"
                        ? "Compensation records"
                        : "Approved payrolls"}
                  </small>
                  <strong>{v}</strong>
                </section>
              ),
            )}
            <section className="stat">
              <small>Time to first approved payroll</small>
              <strong>
                {data.first_payroll_hours === null ||
                data.first_payroll_hours === undefined
                  ? "Pending"
                  : `${Number(data.first_payroll_hours).toFixed(1)} h`}
              </strong>
              <p>Target: 24 hours from company signup</p>
            </section>
          </div>
          <section className="panel ops-form">
            <h2>Current headcount by department</h2>
            {(
              (data.headcount ?? []) as {
                department: string;
                employees: number;
              }[]
            ).map((r) => (
              <div className="ops-bar" key={r.department}>
                <span>{r.department}</span>
                <progress
                  max={Math.max(
                    1,
                    ...((data.headcount ?? []) as { employees: number }[]).map(
                      (x) => x.employees,
                    ),
                  )}
                  value={r.employees}
                />
                <strong>{r.employees}</strong>
              </div>
            ))}
          </section>
          {kind === "analytics" && (
            <>
              <section className="panel ops-form">
                <h2>Payroll and attendance period</h2>
                <div className="ops-form-grid">
                  <label>
                    From
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    Until
                    <input
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                </div>
                <p>
                  Headcount and hiring stages are current snapshots. Payroll
                  includes drafts labelled by status. Attendance covers the
                  latest 31 recorded days; hours include only closed shifts.
                </p>
              </section>
              <section className="panel ops-form">
                <h2>Payroll cost and deductions</h2>
                <Table
                  rows={(
                    (data.payroll ?? []) as {
                      period: string;
                      status: string;
                      gross: number;
                      net: number;
                      tax: number;
                      employer_cost: number;
                    }[]
                  )
                    .filter(
                      (r) =>
                        (!from || r.period >= from.slice(0, 7)) &&
                        (!to || r.period <= to.slice(0, 7)),
                    )
                    .map((r) => ({
                      period: r.period,
                      status: r.status,
                      gross: amount(r.gross),
                      net: amount(r.net),
                      paye: amount(r.tax),
                      employer_cost: amount(r.employer_cost),
                    }))}
                />
                <a href="/api/reports?type=payroll" className="secondary">
                  Export statutory &amp; payment schedule
                </a>
              </section>
              <section className="panel ops-form">
                <h2>Recruiting pipeline · candidates at each current stage</h2>
                <Table
                  rows={(data.funnel ?? []) as Record<string, unknown>[]}
                />
              </section>
              <section className="panel ops-form">
                <h2>Goals, onboarding, reviews, and learning</h2>
                <Table
                  rows={(data.progress ?? []) as Record<string, unknown>[]}
                />
              </section>
              <section className="panel ops-form">
                <h2>Hiring cohorts</h2>
                <p>
                  Staff grouped by recorded join month; active counts describe
                  their current status.
                </p>
                <Table rows={(data.hires ?? []) as Record<string, unknown>[]} />
              </section>
              <section className="panel ops-form">
                <h2>Review ratings by department</h2>
                <p>
                  Arithmetic mean of published 1–5 ratings. Draft reviews are
                  excluded.
                </p>
                <Table
                  rows={(data.ratings ?? []) as Record<string, unknown>[]}
                />
              </section>
              <section className="panel ops-form">
                <h2>Time to hire</h2>
                <p>
                  Elapsed days from candidate record creation to their first
                  Hired event. Candidates without a recorded hire event are
                  excluded.
                </p>
                <Table
                  rows={
                    data.hiring_time
                      ? [data.hiring_time as Record<string, unknown>]
                      : []
                  }
                />
              </section>
              <section className="panel ops-form">
                <h2>Daily attendance</h2>
                <Table
                  rows={((data.attendance ?? []) as { day: string }[]).filter(
                    (r) => (!from || r.day >= from) && (!to || r.day <= to),
                  )}
                />
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
