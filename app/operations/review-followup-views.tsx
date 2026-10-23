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
export default function ReviewFollowupViews({
  filters,
  onApply,
}: {
  filters: InboxFilters;
  onApply: (filters: InboxFilters) => void;
}) {
  const [views, setViews] = useState<View[]>([]),
    [selected, setSelected] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const view = views.find((v) => String(v.id) === selected);
  useEffect(() => {
    let active = true;
    api("review-followup-views")
      .then((d) => {
        if (active) setViews(d.views);
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
      setMessage(view.pinned ? "Saved view unpinned." : "Saved view pinned.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to pin view.");
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
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
