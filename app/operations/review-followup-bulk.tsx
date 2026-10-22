"use client";
import { useState } from "react";
import { api } from "./types";
type Row = {
  id: number;
  employee_name: string;
  status: string;
  version: number;
};
type Payload = {
  requests: { request_id: number; expected_version: number }[];
  owner_id: number | null;
  due: string;
  reason: string;
};
type Preview = {
  preview_hash: string;
  changed: number;
  unchanged: number;
  plan: {
    id: number;
    employee_name: string;
    owner_name: string | null;
    due: string;
    new_owner_name: string | null;
    new_due: string;
    changed: boolean;
  }[];
};
export default function ReviewFollowupBulk({
  rows,
  owners,
  onSaved,
}: {
  rows: Row[];
  owners: { id: number; name: string }[];
  onSaved: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<number[]>([]),
    [owner, setOwner] = useState(""),
    [due, setDue] = useState(""),
    [reason, setReason] = useState(""),
    [preview, setPreview] = useState<(Preview & { payload: Payload }) | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const open = rows.filter((row) => row.status === "Open");
  async function prepare() {
    setBusy(true);
    setError("");
    setMessage("");
    setPreview(null);
    try {
      if (selected.some((id) => !open.some((row) => row.id === id)))
        throw Error(
          "A selected request is no longer open in these filters. Clear the selection and choose again.",
        );
      const payload: Payload = {
        requests: open
          .filter((row) => selected.includes(row.id))
          .map((row) => ({
            request_id: row.id,
            expected_version: row.version,
          })),
        owner_id: owner ? Number(owner) : null,
        due,
        reason,
      };
      const result = await api("review-followup-bulk", {
        action: "preview",
        ...payload,
      });
      setPreview({ ...result, payload });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to preview bulk assignment.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const result = await api("review-followup-bulk", {
        action: "commit",
        ...preview.payload,
        preview_hash: preview.preview_hash,
      });
      setMessage(
        `Bulk assignment saved: ${result.changed} changed; ${result.unchanged} unchanged.`,
      );
      setPreview(null);
      setSelected([]);
      await onSaved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to save bulk assignment.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel ops-form">
      <h2>Bulk owner assignment</h2>
      <p>
        Select up to 200 open follow-ups from the current inbox filters. Preview
        changes before saving. Every selected request must still match the
        reviewed assignment.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <details>
        <summary>Select and preview bulk changes</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void prepare();
          }}
        >
          <fieldset disabled={busy}>
            <legend>Open follow-ups in current filters</legend>
            {open.map((row) => (
              <label key={row.id} className="ops-check">
                <input
                  type="checkbox"
                  checked={selected.includes(row.id)}
                  onChange={(e) => {
                    setPreview(null);
                    setSelected((current) =>
                      e.target.checked
                        ? [...current, row.id]
                        : current.filter((id) => id !== row.id),
                    );
                  }}
                />
                Follow-up #{row.id} · {row.employee_name}
              </label>
            ))}
            {!open.length && <p>No open follow-ups in these filters.</p>}
          </fieldset>
          <p>{selected.length} selected</p>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              setSelected([]);
              setPreview(null);
            }}
          >
            Clear bulk selection
          </button>
          <label>
            Bulk HR owner
            <select
              aria-label="Bulk HR owner"
              value={owner}
              onChange={(e) => {
                setOwner(e.target.value);
                setPreview(null);
              }}
            >
              <option value="">Unassigned</option>
              {owners.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bulk due date
            <input
              type="date"
              value={due}
              onChange={(e) => {
                setDue(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <label>
            Bulk assignment reason
            <textarea
              required
              maxLength={2000}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <button
            className="primary"
            disabled={busy || !selected.length || selected.length > 200}
          >
            Preview bulk assignment
          </button>
        </form>
        {preview && (
          <section>
            <p role="status">
              Preview: {preview.changed} changes · {preview.unchanged} unchanged
            </p>
            <div className="ops-table">
              <table>
                <thead>
                  <tr>
                    <th>Follow-up</th>
                    <th>Current owner</th>
                    <th>Current due date</th>
                    <th>New owner</th>
                    <th>New due date</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.plan.map((row) => (
                    <tr key={row.id}>
                      <td>
                        #{row.id} · {row.employee_name}
                      </td>
                      <td>{row.owner_name || "Unassigned"}</td>
                      <td>{row.due || "Not set"}</td>
                      <td>{row.new_owner_name || "Unassigned"}</td>
                      <td>{row.new_due || "Not set"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void commit()}
            >
              Save reviewed bulk assignment
            </button>
          </section>
        )}
      </details>
    </section>
  );
}
