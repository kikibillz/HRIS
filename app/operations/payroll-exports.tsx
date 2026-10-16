"use client";
import { useEffect, useState } from "react";
import { api, dateTime } from "./types";
type Data = {
  errors: string[];
  settings: {
    columns: { header: string; field: string }[];
    employer: Record<string, string>;
  };
  staff: {
    employee_id: number;
    name: string;
    routing: Record<string, string>;
    reference: string;
  }[];
  artifacts: { id: number; kind: string; sha256: string; created: string }[];
};
const labels = {
  bank: "Bank name",
  bank_account: "Account number",
  bank_code: "Bank code",
  tax_id: "Tax ID",
  pension_id: "Pension identifier",
  nhf_id: "NHF identifier",
  tax_authority: "Resident tax authority",
};
export default function PayrollExports({ runId }: { runId: number }) {
  const [kind, setKind] = useState("bank"),
    [data, setData] = useState<Data | null>(null),
    [employee, setEmployee] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null);
    api(`payroll-exports?run_id=${runId}&kind=${kind}`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Unable to load exports.");
      });
    return () => {
      active = false;
    };
  }, [runId, kind]);
  async function action(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await api("payroll-exports", body);
      setData(await api(`payroll-exports?run_id=${runId}&kind=${kind}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export action failed.");
    } finally {
      setBusy(false);
    }
  }
  const person =
    data?.staff.find((s) => s.employee_id === employee) ?? data?.staff[0];
  return (
    <details className="panel ops-form">
      <summary>Bank exports &amp; statutory filing packs</summary>
      <p>
        Generic, configurable preparation packs. Confirm your bank or
        authority’s required format before upload. Exports do not transfer money
        or submit returns. Bank schedules use recorded outstanding salary;
        statutory schedules use full frozen liabilities with receipts listed
        separately.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <label>
        Export pack type
        <select
          aria-label="Export pack type"
          value={kind}
          disabled={busy}
          onChange={(e) => {
            setError("");
            setKind(e.target.value);
          }}
        >
          <option value="bank">Generic bank schedule</option>
          <option value="statutory">Statutory preparation pack</option>
        </select>
      </label>
      {!data ? (
        <p>Loading export readiness…</p>
      ) : (
        <>
          <h4>Export readiness</h4>
          {data.errors.length ? (
            <ul>
              {data.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            <p>
              Required identifiers are present. Review their accuracy and the
              target portal format.
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action({
                action: "create",
                run_id: runId,
                kind,
                confirmed:
                  new FormData(e.currentTarget).get("confirmed") === "on",
              });
            }}
          >
            <label className="check-label">
              <input name="confirmed" type="checkbox" required />I reviewed
              identifiers, amounts, outstanding balances and the target format.
              This is an export only.
            </label>
            <button
              className="primary"
              disabled={busy || data.errors.length > 0}
            >
              Generate immutable export pack
            </button>
          </form>
          <details>
            <summary>Review export identifiers</summary>
            <p>
              Export-only corrections are audited and do not rewrite approved
              payslips. Existing generated packs retain their original
              identifiers.
            </p>
            <label>
              Export employee
              <select
                aria-label="Export employee"
                value={person?.employee_id ?? 0}
                onChange={(e) => setEmployee(Number(e.target.value))}
              >
                {data.staff.map((s) => (
                  <option key={s.employee_id} value={s.employee_id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {person && (
              <form
                key={`${person.employee_id}:${JSON.stringify(person.routing)}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  const b = Object.fromEntries(new FormData(e.currentTarget));
                  void action({
                    ...b,
                    action: "profile",
                    run_id: runId,
                    employee_id: person.employee_id,
                    confirmed: b.confirmed === "on",
                  });
                }}
              >
                <div className="ops-form-grid">
                  {Object.entries(labels).map(([key, label]) => (
                    <label key={key}>
                      Export {label}
                      <input
                        name={key}
                        maxLength={120}
                        defaultValue={person.routing[key] ?? ""}
                      />
                    </label>
                  ))}
                </div>
                <label>
                  Identifier evidence reference
                  <textarea
                    name="reference"
                    required
                    maxLength={1000}
                    defaultValue={
                      person.reference === "Frozen payroll identifiers"
                        ? ""
                        : person.reference
                    }
                  />
                </label>
                <label className="check-label">
                  <input name="confirmed" type="checkbox" required />I reviewed
                  these routing and filing identifiers against supporting
                  evidence.
                </label>
                <button disabled={busy} className="secondary">
                  Save export identifiers
                </button>
              </form>
            )}
          </details>
          <details>
            <summary>
              Configure generic bank columns &amp; employer references
            </summary>
            <p>
              Edit JSON column mappings using fields: beneficiary, bank,
              bank_code, account_number, amount, currency, reference, narration.
              Column order is preserved. Beneficiary, account_number and amount
              are required. Amounts are decimal NGN. Settings apply only to
              future packs.
            </p>
            <form
              key={JSON.stringify(data.settings)}
              onSubmit={(e) => {
                e.preventDefault();
                const b = Object.fromEntries(new FormData(e.currentTarget));
                try {
                  void action({
                    action: "settings",
                    columns: JSON.parse(String(b.columns)),
                    employer: Object.fromEntries(
                      Object.keys(data.settings.employer).map((k) => [
                        k,
                        b[k] ?? "",
                      ]),
                    ),
                  });
                } catch {
                  setError("Column mappings must be valid JSON.");
                }
              }}
            >
              <label>
                Bank column mappings JSON
                <textarea
                  name="columns"
                  required
                  rows={8}
                  defaultValue={JSON.stringify(data.settings.columns, null, 2)}
                />
              </label>
              <div className="ops-form-grid">
                {Object.entries(data.settings.employer).map(([key, value]) => (
                  <label key={key}>
                    Employer {key.replaceAll("_", " ")}
                    <input name={key} maxLength={120} defaultValue={value} />
                  </label>
                ))}
              </div>
              <button className="secondary" disabled={busy}>
                Save export settings
              </button>
            </form>
          </details>
          <h4>Generated pack history</h4>
          {!data.artifacts.length && <p>No generated packs yet.</p>}
          <ul>
            {data.artifacts.map((a) => (
              <li key={a.id}>
                <a href={`/api/payroll-exports?artifact_id=${a.id}`} download>
                  Download {a.kind} pack #{a.id}
                </a>{" "}
                · {dateTime(a.created)}
                <details>
                  <summary>Pack fingerprint</summary>
                  <pre className="ops-code">{a.sha256}</pre>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
