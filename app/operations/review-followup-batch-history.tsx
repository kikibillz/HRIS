"use client";
import { useState } from "react";
import { api, dateTime } from "./types";
export type FollowupBatch = {
  id: number;
  actor_id: number;
  actor_name: string;
  created: string;
  reason: string;
  selected: number;
  changed: number;
  unchanged: number;
};
type Artifact = {
  content_hash: string;
  payload: {
    batch: {
      id: number;
      actor_id: number;
      actor_name: string | null;
      created: string;
    };
    input: { reason: string };
    result: { changed: number; unchanged: number };
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
};
export default function ReviewFollowupBatchHistory({
  batches,
}: {
  batches: FollowupBatch[];
}) {
  const [selected, setSelected] = useState<Artifact | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function inspect(id: number) {
    setBusy(true);
    setError("");
    setSelected(null);
    try {
      setSelected(await api(`review-followup-bulk?id=${id}`));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load batch history.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel ops-form">
      <h2>Completed bulk assignment history</h2>
      <p>
        Inspect saved plans and results. Later ownership, due-date or profile
        changes do not rewrite these completed batches.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <details>
        <summary>Browse completed batches</summary>
        {batches.map((batch) => (
          <article key={batch.id} className="ops-record">
            <h3>Batch #{batch.id}</h3>
            <p>
              {dateTime(batch.created)} ·{" "}
              {batch.actor_name || "Recorded HR administrator"}
            </p>
            <p>
              {batch.selected} selected · {batch.changed} changed ·{" "}
              {batch.unchanged} unchanged
            </p>
            <p className="preserve-lines">{batch.reason}</p>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void inspect(batch.id)}
            >
              View reviewed changes · Batch #{batch.id}
            </button>
            <p>
              <a href={`/api/review-followup-bulk?id=${batch.id}`}>
                Download batch #{batch.id}
              </a>
            </p>
          </article>
        ))}
        {!batches.length && <p>No completed bulk assignments yet.</p>}
      </details>
      {selected && (
        <section>
          <h3>Reviewed changes · Batch #{selected.payload.batch.id}</h3>
          <p>
            Saved by{" "}
            {selected.payload.batch.actor_name || "Recorded HR administrator"} ·{" "}
            {dateTime(selected.payload.batch.created)}
          </p>
          <p className="preserve-lines">{selected.payload.input.reason}</p>
          <div className="ops-table">
            <table>
              <thead>
                <tr>
                  <th>Follow-up</th>
                  <th>Previous owner</th>
                  <th>Previous due date</th>
                  <th>Saved owner</th>
                  <th>Saved due date</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {selected.payload.plan.map((row) => (
                  <tr key={row.id}>
                    <td>
                      #{row.id} · {row.employee_name}
                    </td>
                    <td>{row.owner_name || "Unassigned"}</td>
                    <td>{row.due || "Not set"}</td>
                    <td>{row.new_owner_name || "Unassigned"}</td>
                    <td>{row.new_due || "Not set"}</td>
                    <td>{row.changed ? "Changed" : "Unchanged"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Download includes a SHA-256 checksum for inspecting the saved
            evidence.
          </p>
        </section>
      )}
    </section>
  );
}
