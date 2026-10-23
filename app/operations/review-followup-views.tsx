"use client";
import { useEffect, useState } from "react";
import type { InboxFilters } from "@/lib/review-followup-views";
import { api } from "./types";
type View = {
  id: number;
  name: string;
  version: number;
  pinned: number;
  filters: InboxFilters;
};
function FilterPreview({
  stored,
  current,
  label,
}: {
  stored: InboxFilters;
  current: InboxFilters;
  label: string;
}) {
  const ownership = (value: string) =>
    value === "mine"
      ? "Assigned to me"
      : value === "unassigned"
        ? "Unassigned"
        : "All owners";
  const rows = [
    ["Request status", stored.status, current.status],
    ["Ownership", ownership(stored.ownership), ownership(current.ownership)],
    [
      "Overdue only",
      stored.overdue_only ? "Yes" : "No",
      current.overdue_only ? "Yes" : "No",
    ],
    [
      "Needs HR owner",
      stored.needs_hr_owner ? "Yes" : "No",
      current.needs_hr_owner ? "Yes" : "No",
    ],
    [
      "Search follow-ups",
      stored.search || "No search",
      current.search || "No search",
    ],
  ];
  const matches = (Object.keys(stored) as (keyof InboxFilters)[]).every(
    (key) => stored[key] === current[key],
  );
  return (
    <div role="region" aria-label={label}>
      <h3>{label}</h3>
      <p>
        {matches
          ? "These filters match the current inbox."
          : "These filters differ from the current inbox."}
      </p>
      <div
        className="ops-table"
        tabIndex={0}
        role="region"
        aria-label={`${label} comparison table`}
      >
        <table>
          <caption>Stored filters compared with your current inbox</caption>
          <thead>
            <tr>
              <th scope="col">Filter</th>
              <th scope="col">Stored</th>
              <th scope="col">Current</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, saved, active]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {saved}
                </td>
                <td
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {active}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
export default function ReviewFollowupViews({
  filters,
  onApply,
}: {
  filters: InboxFilters;
  onApply: (filters: InboxFilters) => void;
}) {
  const [views, setViews] = useState<View[]>([]),
    [archivedViews, setArchivedViews] = useState<View[]>([]),
    [archivedId, setArchivedId] = useState(""),
    [restoreName, setRestoreName] = useState(""),
    [selected, setSelected] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const view = views.find((v) => String(v.id) === selected);
  const archivedView = archivedViews.find((v) => String(v.id) === archivedId);
  useEffect(() => {
    let active = true;
    api("review-followup-views")
      .then((d) => {
        if (active) {
          setViews(d.views);
          setArchivedViews(d.archived_views);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const d = await api("review-followup-views");
      setViews(d.views);
      setArchivedViews(d.archived_views);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load views.");
    } finally {
      setBusy(false);
    }
  }
  async function save(action: "save" | "archive", update = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api("review-followup-views", {
        action,
        name,
        filters,
        ...(update && view
          ? { id: view.id, expected_version: view.version }
          : {}),
      });
      const data = await api("review-followup-views");
      setViews(data.views);
      setArchivedViews(data.archived_views);
      setSelected(action === "archive" ? "" : String(result.id));
      setMessage(
        action === "archive"
          ? "Saved view archived."
          : result.unchanged
            ? "Saved view is already up to date."
            : "Private view saved.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save view.");
    } finally {
      setBusy(false);
    }
  }
  async function pin() {
    if (!view) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("review-followup-views", {
        action: "pin",
        id: view.id,
        expected_version: view.version,
        pinned: !view.pinned,
      });
      const data = await api("review-followup-views");
      setViews(data.views);
      setArchivedViews(data.archived_views);
      setMessage(view.pinned ? "Saved view unpinned." : "Saved view pinned.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to pin view.");
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    const archived = archivedViews.find((v) => String(v.id) === archivedId);
    if (!archived) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api("review-followup-views", {
        action: "restore",
        id: archived.id,
        expected_version: archived.version,
        name: restoreName,
      });
      const data = await api("review-followup-views");
      setViews(data.views);
      setArchivedViews(data.archived_views);
      setSelected(String(result.id));
      setName(restoreName.trim());
      setArchivedId("");
      setRestoreName("");
      setMessage("Saved view restored. Apply it to reopen its filters.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to restore view.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel ops-form">
      <h2>My saved inbox views</h2>
      <p>
        Save the current filters for your account. Views do not store questions
        or change assignments. Authorized company backups include these
        preferences. Pin favorites for quick access across sessions.
      </p>
      <div className="ops-actions" aria-label="Pinned inbox views">
        {views
          .filter((v) => v.pinned)
          .map((v) => (
            <button
              key={v.id}
              disabled={busy}
              onClick={() => {
                setSelected(String(v.id));
                setName(v.name);
                onApply(v.filters);
                setMessage("Saved view applied.");
              }}
            >
              Apply pinned view: {v.name}
            </button>
          ))}
      </div>
      <label>
        Saved inbox view
        <select
          aria-label="Saved inbox view"
          value={selected}
          disabled={busy}
          onChange={(e) => {
            setSelected(e.target.value);
            setName(
              views.find((v) => String(v.id) === e.target.value)?.name || "",
            );
          }}
        >
          <option value="">Choose a view</option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.pinned ? `Pinned · ${v.name}` : v.name}
            </option>
          ))}
        </select>
      </label>
      {view && (
        <FilterPreview
          stored={view.filters}
          current={filters}
          label="Saved view filters"
        />
      )}
      <div className="ops-actions">
        <button
          disabled={busy || !view}
          onClick={() => {
            if (view) {
              onApply(view.filters);
              setMessage("Saved view applied.");
            }
          }}
        >
          Apply saved view
        </button>
        <button disabled={busy || !view} onClick={pin}>
          {view?.pinned ? "Unpin selected view" : "Pin selected view"}
        </button>
        <button disabled={busy} onClick={refresh}>
          Refresh saved views
        </button>
      </div>
      <label>
        View name
        <input
          aria-label="View name"
          value={name}
          maxLength={100}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="ops-actions">
        <button disabled={busy || !name.trim()} onClick={() => save("save")}>
          Save filters as new view
        </button>
        <button
          disabled={busy || !view || !name.trim()}
          onClick={() => save("save", true)}
        >
          Update selected view
        </button>
        <button disabled={busy || !view} onClick={() => save("archive", true)}>
          Archive selected view
        </button>
      </div>
      <details>
        <summary>Restore archived views ({archivedViews.length})</summary>
        <p>
          Restore your archived filters under their original name or a new name.
          Restored views start unpinned.
        </p>
        <label>
          Archived inbox view
          <select
            aria-label="Archived inbox view"
            value={archivedId}
            disabled={busy}
            onChange={(e) => {
              setArchivedId(e.target.value);
              setRestoreName(
                archivedViews.find((v) => String(v.id) === e.target.value)
                  ?.name || "",
              );
            }}
          >
            <option value="">Choose an archived view</option>
            {archivedViews.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · #{v.id}
              </option>
            ))}
          </select>
        </label>
        {archivedView && (
          <FilterPreview
            stored={archivedView.filters}
            current={filters}
            label="Archived view filters"
          />
        )}
        <label>
          Restore view name
          <input
            aria-label="Restore view name"
            value={restoreName}
            maxLength={100}
            disabled={busy}
            onChange={(e) => setRestoreName(e.target.value)}
          />
        </label>
        <button
          disabled={
            busy ||
            !archivedViews.some((v) => String(v.id) === archivedId) ||
            !restoreName.trim()
          }
          onClick={restore}
        >
          Restore selected view
        </button>
      </details>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
