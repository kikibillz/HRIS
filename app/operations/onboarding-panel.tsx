"use client";
import { useEffect, useState } from "react";
import { api, type Context } from "./types";
type Item = { title: string; body: string; days: number };
type Template = { id: number; title: string; status: string; items: Item[] };
type Assignment = {
  id: number;
  title: string;
  name: string;
  start_date: string;
  total: number;
  completed: number;
};
export default function OnboardingPanel({ context }: { context: Context }) {
  const [templates, setTemplates] = useState<Template[]>([]),
    [assignments, setAssignments] = useState<Assignment[]>([]),
    [items, setItems] = useState<Item[]>([{ title: "", body: "", days: 0 }]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState("");
  async function load() {
    const result = await api("onboarding");
    setTemplates(result.templates);
    setSelected((current) =>
      result.templates.some(
        (t: Template) => t.id === Number(current) && t.status === "Active",
      )
        ? current
        : "",
    );
    setAssignments(result.assignments);
  }
  useEffect(() => {
    let active = true;
    api("onboarding")
      .then((result) => {
        if (active) {
          setTemplates(result.templates);
          setAssignments(result.assignments);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function perform(body: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api("onboarding", body);
      await load();
      setMessage(
        result.created === undefined
          ? "Saved successfully."
          : `${result.created} checklists assigned · ${result.tasks_created} tasks created · ${result.skipped} existing assignments skipped.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }
  function update(index: number, patch: Partial<Item>) {
    setItems((old) =>
      old.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }
  const active = templates.filter((t) => t.status === "Active");
  return (
    <>
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
      <section className="panel ops-form">
        <h2>Create onboarding template</h2>
        <p>
          Save up to 20 tasks. Due dates use calendar days relative to a start
          date; negative offsets cover preboarding. Saved templates are
          immutable: create a new template for revisions.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void perform({ action: "create", title: form.get("title"), items });
          }}
        >
          <label>
            Template name
            <input name="title" required maxLength={200} />
          </label>
          {items.map((item, index) => (
            <fieldset key={index}>
              <legend>Task {index + 1}</legend>
              <label>
                Task title
                <input
                  required
                  maxLength={200}
                  value={item.title}
                  onChange={(e) => update(index, { title: e.target.value })}
                />
              </label>
              <label>
                Task details
                <textarea
                  maxLength={2000}
                  value={item.body}
                  onChange={(e) => update(index, { body: e.target.value })}
                />
              </label>
              <label>
                Calendar days from start
                <input
                  type="number"
                  min={-30}
                  max={365}
                  required
                  value={Number.isNaN(item.days) ? "" : item.days}
                  onChange={(e) =>
                    update(index, {
                      days:
                        e.target.value === "" ? NaN : Number(e.target.value),
                    })
                  }
                />
              </label>
              {items.length > 1 && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    setItems((old) => old.filter((_, i) => i !== index))
                  }
                >
                  Remove task {index + 1}
                </button>
              )}
            </fieldset>
          ))}
          <div className="ops-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy || items.length >= 20}
              onClick={() =>
                setItems((old) => [...old, { title: "", body: "", days: 0 }])
              }
            >
              Add template task
            </button>
            <button className="primary" disabled={busy}>
              Save onboarding template
            </button>
          </div>
        </form>
      </section>
      <section className="panel ops-form">
        <h2>Assign a checklist</h2>
        <p>
          Choose up to 50 active employees. Repeating the same template,
          employee and start date skips existing assignments, including
          completed tasks. New assignments appear in each employee’s Onboarding
          checklists and notifications.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void perform({
              action: "assign",
              template_id: Number(form.get("template_id")),
              start_date: form.get("start_date"),
              employee_ids: form.getAll("employee_ids").map(Number),
            });
          }}
        >
          <label>
            Onboarding template
            <select
              required
              name="template_id"
              aria-label="Onboarding template"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Choose template</option>
              {active.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          {active
            .find((t) => t.id === Number(selected))
            ?.items.map((item, i) => (
              <p key={i}>
                {item.title} · {item.days} calendar days from start
              </p>
            ))}
          <label>
            Checklist start date
            <input
              name="start_date"
              type="date"
              required
              min="1900-01-01"
              max="9999-01-01"
            />
          </label>
          <fieldset>
            <legend>Employees to onboard</legend>
            {context.employees
              .filter((p) => p.status === "Active")
              .map((p) => (
                <label className="ops-check" key={p.id}>
                  <input type="checkbox" name="employee_ids" value={p.id} />
                  {p.name}
                </label>
              ))}
          </fieldset>
          <button className="primary" disabled={busy || !active.length}>
            Assign onboarding checklists
          </button>
        </form>
      </section>
      <section className="panel ops-form">
        <h2>Saved templates</h2>
        {templates.map((t) => (
          <div key={t.id}>
            <p>
              {t.title} · {t.status} · {t.items.length} tasks
            </p>
            {t.status === "Active" && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Archive ${t.title}? Existing assignments will remain.`,
                    )
                  )
                    void perform({ action: "archive", template_id: t.id });
                }}
              >
                Archive {t.title}
              </button>
            )}
          </div>
        ))}
      </section>
      <section className="panel ops-form">
        <h2>Recent onboarding assignments</h2>
        <p>
          Latest 100 checklists.{" "}
          <a href="/operations?tab=tasks">Open tasks to update completion</a>.
        </p>
        {assignments.map((a) => (
          <div key={a.id}>
            <h3>
              {a.name} · {a.title}
            </h3>
            <p>
              Start {a.start_date} · {a.completed} of {a.total} tasks done
            </p>
            <progress
              aria-label={`${a.name}: ${a.title}`}
              value={a.completed}
              max={a.total || 1}
            />
          </div>
        ))}
      </section>
    </>
  );
}
