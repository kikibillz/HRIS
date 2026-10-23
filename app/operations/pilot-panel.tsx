"use client";
import { useEffect, useState } from "react";
import { pilotRoles, pilotStatuses } from "@/lib/pilot-cases";
import { api, dateTime } from "./types";
type Result = {
  id: number;
  version: number;
  status: string;
  tester: string;
  tester_role: string;
  revision: string;
  note: string;
  actor_name: string;
  created: string;
};
type Case = {
  id: string;
  title: string;
  expected: string;
  latest: Result | null;
  history: Result[];
};
export default function PilotPanel() {
  const [cases, setCases] = useState<Case[]>([]),
    [selected, setSelected] = useState("staff"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const item = cases.find((c) => c.id === selected);
  useEffect(() => {
    let active = true;
    api("pilot")
      .then((d) => {
        if (active) setCases(d.cases);
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
    setMessage("");
    try {
      setCases((await api("pilot")).cases);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load checklist.");
    } finally {
      setBusy(false);
    }
  }
  async function record(form: HTMLFormElement) {
    if (!item) return;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api("pilot", {
        case_id: item.id,
        expected_version: item.latest?.version || 0,
        status: data.get("status"),
        tester: data.get("tester"),
        tester_role: data.get("tester_role"),
        revision: data.get("revision"),
        note: data.get("note"),
      });
      setCases((await api("pilot")).cases);
      setMessage(
        result.unchanged
          ? "This result is already recorded."
          : "Pilot result recorded. Earlier evidence is preserved.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to record result.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel ops-form">
        <h2>Your staff pilot</h2>
        <p>
          Use fictional data to test the workflows with HR, a manager and an
          employee. HR records their reported results here. Tester names and
          roles are stated evidence, not independently verified identities.
          These results do not approve payroll or authorize production launch;
          accountant sign-off remains separate.
        </p>
        <p role="status">
          {pilotStatuses
            .map(
              (status) =>
                `${cases.filter((c) => (c.latest?.status || "Pending") === status).length} ${status.toLowerCase()}`,
            )
            .join(" · ")}
        </p>
        <label>
          Test workflow
          <select
            aria-label="Test workflow"
            value={selected}
            disabled={busy}
            onChange={(e) => {
              setSelected(e.target.value);
              setError("");
              setMessage("");
            }}
          >
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} — {c.latest?.status || "Pending"}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy} onClick={refresh}>
          Refresh pilot checklist
        </button>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </section>
      {item && (
        <section className="panel ops-form">
          <h2>{item.title}</h2>
          <p>{item.expected}</p>
          <p>
            Current recorded result:{" "}
            <strong>{item.latest?.status || "Pending"}</strong>. Record the
            tested app revision and an evidence reference or issue summary. Keep
            passwords, bank details and private staff data out of notes.
          </p>
          <form
            key={`${item.id}:${item.latest?.version || 0}`}
            onSubmit={(e) => {
              e.preventDefault();
              record(e.currentTarget);
            }}
          >
            <fieldset
              disabled={busy}
              style={{ border: 0, padding: 0, minWidth: 0 }}
            >
              <label>
                Test result
                <select
                  aria-label="Test result"
                  name="status"
                  defaultValue={item.latest?.status || "Pending"}
                >
                  {pilotStatuses.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Reported tester
                <input
                  aria-label="Reported tester"
                  name="tester"
                  required
                  maxLength={100}
                  defaultValue={item.latest?.tester || ""}
                />
              </label>
              <label>
                Tester role
                <select
                  aria-label="Tester role"
                  name="tester_role"
                  defaultValue={item.latest?.tester_role || "HR"}
                >
                  {pilotRoles.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Tested app revision
                <input
                  aria-label="Tested app revision"
                  name="revision"
                  required
                  maxLength={100}
                  defaultValue={item.latest?.revision || ""}
                  placeholder="Git commit or release reference"
                />
              </label>
              <label>
                Evidence or issue notes
                <textarea
                  aria-label="Evidence or issue notes"
                  name="note"
                  required
                  maxLength={2000}
                  defaultValue={item.latest?.note || ""}
                />
              </label>
              <button type="submit">Record pilot result</button>
            </fieldset>
          </form>
          <details>
            <summary>Recorded pilot history ({item.history.length})</summary>
            {item.history.length ? (
              <ol>
                {item.history.map((r) => (
                  <li key={r.id}>
                    <strong>{r.status}</strong> · {dateTime(r.created)}
                    <p>
                      Reported tester: {r.tester} ({r.tester_role}). Revision:{" "}
                      {r.revision}. Recorded by {r.actor_name}.
                    </p>
                    <p className="preserve-lines">{r.note}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No results have been recorded for this workflow.</p>
            )}
          </details>
        </section>
      )}
    </>
  );
}
