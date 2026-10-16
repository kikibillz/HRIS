"use client";
import { useEffect, useState } from "react";
import { api } from "./types";
type Data = {
  candidates: { id: number; title: string; email: string; job: string }[];
  employees: { id: number; name: string; email: string }[];
  departments: { id: number; name: string }[];
  templates: { id: number; title: string }[];
  handoffs: {
    applicant_id: number;
    employee_id: number;
    title: string;
    name: string;
    mode: string;
    onboarding_assignment_id: number | null;
  }[];
};
type Input = {
  applicant_id: number;
  mode: string;
  employee_id: number | null;
  work_email: string;
  role: string;
  department_id: number | null;
  start_date: string;
  template_id: number | null;
};
type Preview = {
  hash: string;
  candidate: string;
  mode: string;
  existing_employee_id: number | null;
  existing_assignment_id: number | null;
  employee: {
    name: string;
    email: string;
    role: string;
    department: string;
    joined: string;
  };
  start_date: string;
  template: string | null;
  tasks: { title: string; body: string; due: string; status?: string }[];
};
export default function RecruitingHandoffPanel() {
  const [data, setData] = useState<Data | null>(null),
    [candidate, setCandidate] = useState(""),
    [mode, setMode] = useState("create"),
    [preview, setPreview] = useState<{ input: Input; review: Preview } | null>(
      null,
    ),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    api("recruiting-handoff")
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  const completed = data?.handoffs.find(
    (h) => h.applicant_id === Number(candidate),
  );
  return (
    <>
      <section className="panel ops-form">
        <h2>Review a hired candidate’s handoff</h2>
        <p>
          Create an employee record or explicitly link an existing employee in
          this company. Linking preserves their profile, account, password, role
          and payroll data. No login or invitation is created; use the existing
          account-access workflow separately.
        </p>
        <p>
          The candidate must be Hired with a recorded hiring approval. Legacy
          hires without approval can still use staff import or employee records.
          Optional onboarding uses the reviewed start date and preserves any
          existing matching checklist.
        </p>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="ops-success" role="status">
          {message}
        </p>
      )}
      {!data ? (
        <p>Loading handoff choices…</p>
      ) : (
        <>
          <section className="panel ops-form">
            <label>
              Hired candidate
              <select
                aria-label="Handoff candidate"
                value={candidate}
                onChange={(e) => {
                  setCandidate(e.target.value);
                  setPreview(null);
                  setError("");
                  setMessage("");
                }}
              >
                <option value="">Choose hired candidate</option>
                {data.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} · {c.job}
                  </option>
                ))}
              </select>
            </label>
            {!data.candidates.length && <p>No hired candidates yet.</p>}
            {completed ? (
              <p>
                Handoff already completed: {completed.name}.{" "}
                {completed.onboarding_assignment_id
                  ? "An onboarding checklist is linked."
                  : "No checklist was assigned."}
              </p>
            ) : (
              candidate && (
                <form
                  key={candidate}
                  onChange={() => setPreview(null)}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    const input: Input = {
                      applicant_id: Number(candidate),
                      mode,
                      employee_id: f.get("employee_id")
                        ? Number(f.get("employee_id"))
                        : null,
                      work_email: String(f.get("work_email") ?? ""),
                      role: String(f.get("role") ?? ""),
                      department_id: f.get("department_id")
                        ? Number(f.get("department_id"))
                        : null,
                      start_date: String(f.get("start_date")),
                      template_id: f.get("template_id")
                        ? Number(f.get("template_id"))
                        : null,
                    };
                    setBusy(true);
                    setError("");
                    setMessage("");
                    try {
                      const result = await api("recruiting-handoff", {
                        action: "preview",
                        ...input,
                      });
                      setPreview({ input, review: result.preview });
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : "Unable to preview.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label>
                    Handoff mode
                    <select
                      aria-label="Handoff mode"
                      value={mode}
                      onChange={(e) => setMode(e.target.value)}
                    >
                      <option value="create">Create employee record</option>
                      <option value="link">Link existing employee</option>
                    </select>
                  </label>
                  {mode === "create" ? (
                    <>
                      <label>
                        Work email
                        <input
                          name="work_email"
                          type="email"
                          maxLength={254}
                          required
                          defaultValue={
                            data.candidates.find(
                              (c) => c.id === Number(candidate),
                            )?.email
                          }
                        />
                      </label>
                      <label>
                        Employee job title
                        <input
                          name="role"
                          maxLength={120}
                          required
                          defaultValue={
                            data.candidates.find(
                              (c) => c.id === Number(candidate),
                            )?.job
                          }
                        />
                      </label>
                      <label>
                        Employee department
                        <select
                          aria-label="Employee department"
                          name="department_id"
                          required
                        >
                          <option value="">Choose department</option>
                          {data.departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : (
                    <label>
                      Existing employee
                      <select
                        aria-label="Existing handoff employee"
                        name="employee_id"
                        required
                      >
                        <option value="">Choose employee to link</option>
                        {data.employees.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {p.email}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    Handoff start date
                    <input
                      name="start_date"
                      type="date"
                      required
                      min="1900-01-01"
                      max="9999-01-01"
                    />
                  </label>
                  <label>
                    Optional onboarding template
                    <select
                      aria-label="Handoff onboarding template"
                      name="template_id"
                    >
                      <option value="">No onboarding assignment</option>
                      {data.templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="primary" disabled={busy}>
                    Preview employee handoff
                  </button>
                </form>
              )
            )}
          </section>
          {preview && !completed && (
            <section className="panel ops-form">
              <h2>Confirm reviewed handoff</h2>
              <p>Candidate: {preview.review.candidate}</p>
              <p>
                {preview.review.mode === "create"
                  ? "Create employee record"
                  : "Link existing employee without profile changes"}
                : {preview.review.employee.name} ·{" "}
                {preview.review.employee.email}
              </p>
              <p>
                {preview.review.employee.role} ·{" "}
                {preview.review.employee.department} · Employee joined{" "}
                {preview.review.employee.joined}
              </p>
              <p>
                Checklist start: {preview.review.start_date} · Template:{" "}
                {preview.review.template ?? "None"}
              </p>
              {preview.review.existing_assignment_id && (
                <p>
                  An existing checklist will be linked. Its tasks and completion
                  history will be preserved.
                </p>
              )}
              <ul>
                {preview.review.tasks.map((task, i) => (
                  <li key={i}>
                    {task.title} · Due {task.due}{" "}
                    {task.status ? `· ${task.status}` : ""}
                    <p>{task.body}</p>
                  </li>
                ))}
              </ul>
              <p>
                No login, password change, payroll setup or invitation will be
                created.
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    const result = await api("recruiting-handoff", {
                      ...preview.input,
                      action: "commit",
                      preview_hash: preview.review.hash,
                      confirmed: true,
                    });
                    setPreview(null);
                    setMessage(
                      result.already_completed
                        ? "Handoff was already completed; no duplicate was created."
                        : "Employee handoff completed. Account access remains unchanged.",
                    );
                    setRevision((v) => v + 1);
                  } catch (e) {
                    setPreview(null);
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Unable to complete handoff.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label className="ops-check">
                  <input type="checkbox" required />I reviewed the employee
                  details and onboarding dates
                </label>
                <button className="primary" disabled={busy}>
                  Complete employee handoff
                </button>
              </form>
            </section>
          )}
          <section className="panel ops-form">
            <h2>Completed handoffs</h2>
            {!data.handoffs.length && <p>No completed handoffs.</p>}
            {data.handoffs.map((h) => (
              <p key={h.applicant_id}>
                {h.title} → {h.name} ·{" "}
                {h.mode === "create"
                  ? "Employee record created"
                  : "Existing employee linked"}{" "}
                ·{" "}
                {h.onboarding_assignment_id
                  ? "Onboarding linked"
                  : "No onboarding assignment"}
              </p>
            ))}
            <p>
              <a href="/operations?tab=people">Open employee records</a> ·{" "}
              <a href="/operations?tab=onboarding-progress">
                Open onboarding progress
              </a>{" "}
              · <a href="/">Manage account invitations</a>
            </p>
          </section>
        </>
      )}
    </>
  );
}
