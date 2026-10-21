"use client";
import { useEffect, useState } from "react";
import PerformanceCycles from "./performance-cycles";
import ReviewAcknowledgment from "./review-acknowledgment";
import ReviewFollowups from "./review-followups";
import { modules, referenceKinds } from "@/lib/modules";
import { api, type Context, type Row } from "./types";
export default function RecordsPanel({
  kind,
  context,
}: {
  kind: string;
  context: Context;
}) {
  const m = modules[kind],
    admin = context.user.access === "admin";
  const [rows, setRows] = useState<Row[]>([]),
    [references, setReferences] = useState<Row[]>([]),
    [editing, setEditing] = useState<Row | null | undefined>(undefined),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState("");
  async function load() {
    try {
      const [data, refs] = await Promise.all([
        api("records/" + kind),
        referenceKinds[kind]
          ? api("records/" + referenceKinds[kind])
          : Promise.resolve({ rows: [] }),
      ]);
      setRows(data.rows);
      setReferences(refs.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load.");
    }
  }
  useEffect(() => {
    setRows([]);
    setEditing(undefined);
    setError("");
    void load();
  }, [kind]);
  const people = context.employees.filter(
    (p) =>
      admin ||
      p.id === context.user.employee_id ||
      context.managed.some((r) => r.employee_id === p.id),
  );
  const canCreate =
    admin ||
    ![
      "jobs",
      "applicants",
      "templates",
      "letters",
      "reviews",
      "policies",
      "courses",
    ].includes(kind) ||
    (kind === "reviews" && context.user.access === "manager");
  const canEdit = (r: Row) => {
    if (
      (kind === "enrollments" && r.status === "Completed") ||
      kind === "letters" ||
      (r.status === "Published" && kind === "reviews") ||
      (r.status === "Submitted" && kind === "feedback")
    )
      return false;
    if (admin) return true;
    if (["courses", "policies"].includes(kind)) return false;
    if (["reviews", "feedback"].includes(kind))
      return r.reviewer_id === context.user.employee_id;
    return true;
  };
  return (
    <>
      {kind === "reviews" && admin && (
        <PerformanceCycles
          context={context}
          onAssigned={load}
          reviewState={JSON.stringify(rows)}
        />
      )}
      <div className="ops-toolbar">
        <label>
          Search
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${m.title.toLowerCase()}`}
          />
        </label>
        {canCreate && (
          <button
            className="primary"
            onClick={() => {
              setError("");
              setEditing(null);
            }}
          >
            Add {kind === "applicants" ? "candidate" : "record"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {editing !== undefined && (
        <section className="panel ops-form">
          <h2>
            {editing ? "Update" : "Create"} {m.title.toLowerCase()}
          </h2>
          <form
            key={editing?.id ?? "new"}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const values = Object.fromEntries(
                  new FormData(e.currentTarget),
                );
                await api(
                  "records/" + kind,
                  { ...values, ...(editing ? { id: editing.id } : {}) },
                  editing ? "PATCH" : "POST",
                );
                setEditing(undefined);
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Unable to save.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="ops-form-grid">
              {m.fields.map((f) => {
                const value =
                  editing?.data[f.key] ??
                  (f.key === "employee_id" ? context.user.employee_id : "");
                const disabled =
                  !!editing &&
                  ["employee_id", "reviewer_id", "reference_id"].includes(
                    f.key,
                  );
                return (
                  <label key={f.key}>
                    {f.label}
                    {f.type === "textarea" ? (
                      <textarea
                        aria-label={f.label}
                        name={f.key}
                        defaultValue={String(value)}
                        required={f.required}
                        maxLength={20000}
                      />
                    ) : f.type === "employee" ||
                      f.type === "reviewer" ||
                      f.type === "reference" ? (
                      <select
                        aria-label={f.label}
                        name={f.key}
                        defaultValue={value}
                        required={f.required}
                        disabled={disabled}
                      >
                        <option value="">Select…</option>
                        {f.type === "reference"
                          ? references.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.title}
                              </option>
                            ))
                          : (f.type === "reviewer"
                              ? context.peers
                              : people
                            ).map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                      </select>
                    ) : (
                      <input
                        aria-label={f.label}
                        name={f.key}
                        type={f.type ?? "text"}
                        defaultValue={String(value)}
                        required={f.required}
                        min={f.min}
                        max={f.max}
                        maxLength={500}
                      />
                    )}
                  </label>
                );
              })}
              <label>
                Status
                <select
                  aria-label="Status"
                  name="status"
                  defaultValue={editing?.status ?? m.statuses[0]}
                >
                  {m.statuses
                    .filter(
                      (s) =>
                        !(kind === "reviews" && s === "Published" && !admin),
                    )
                    .map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                </select>
              </label>
            </div>
            <div className="ops-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setEditing(undefined)}
                disabled={busy}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save record"}
              </button>
            </div>
          </form>
        </section>
      )}
      <div className="ops-cards">
        {rows
          .filter((r) =>
            (r.title + " " + r.body)
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((r) => (
            <article className="panel ops-record" key={r.id}>
              <div className="section-head">
                <h2>{r.title}</h2>
                <span className="dept-tag">{r.status}</span>
              </div>
              {r.employee_id && (
                <p>
                  Employee:{" "}
                  {context.peers.find((p) => p.id === r.employee_id)?.name ??
                    "Employee"}
                </p>
              )}
              {r.reviewer_id && (
                <p>
                  Reviewer:{" "}
                  {context.peers.find((p) => p.id === r.reviewer_id)?.name ??
                    "Reviewer"}
                </p>
              )}
              <p className="preserve-lines">{r.body}</p>
              {kind === "goals" && (
                <>
                  <progress max={100} value={r.progress} />
                  <p>{r.progress}% complete</p>
                </>
              )}
              {r.due && <p>Due {r.due}</p>}
              {r.data.rating && <p>Rating: {r.data.rating} / 5</p>}
              {r.data.email && <p>{r.data.email}</p>}
              {r.data.quiz_question && (
                <p>Knowledge check: {r.data.quiz_question}</p>
              )}
              {r.data.url && (
                <a
                  href={String(r.data.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open learning material
                </a>
              )}
              {kind === "enrollments" && (
                <p>
                  {
                    references.find((c) => c.id === r.reference_id)?.data
                      .quiz_question
                  }
                </p>
              )}
              {kind === "reviews" && r.status === "Published" && (
                <ReviewAcknowledgment
                  row={r}
                  context={context}
                  onAcknowledged={load}
                />
              )}
              {kind === "reviews" && r.status === "Published" && (
                <ReviewFollowups row={r} context={context} onSaved={load} />
              )}
              {canEdit(r) && (
                <button
                  className="secondary"
                  onClick={() => {
                    setEditing(r);
                    setError("");
                  }}
                >
                  Update record
                </button>
              )}
              {kind === "letters" && (
                <button className="secondary" onClick={() => window.print()}>
                  Print / Save PDF
                </button>
              )}
            </article>
          ))}
      </div>
      {!rows.length && (
        <p className="ops-empty">
          No records yet.{" "}
          {canCreate
            ? "Add a record to start this workflow."
            : "Your HR team will publish or assign records here."}
        </p>
      )}
    </>
  );
}
