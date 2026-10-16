"use client";
import { useEffect, useState } from "react";
import { api, amount, dateTime, type Context } from "./types";
import type { LedgerAmounts } from "@/lib/payroll-ledger";
type LedgerRow = {
  employee_id: number;
  name: string;
  through_period: string;
  totals: LedgerAmounts;
  payroll_amounts: LedgerAmounts;
  opening: { through_period: string; amounts: LedgerAmounts } | null;
  entries: { period: string; status: string }[];
  unrecorded_periods: string[];
};
type OpeningRow = {
  employee_id: number;
  through_period: string;
  data: string;
  reviewed_by: string;
  reference: string;
};
type LedgerData = {
  rows: LedgerRow[];
  openings: OpeningRow[];
  events: {
    id: number;
    employee_id: number;
    action: string;
    created: string;
  }[];
};
const openingFields = {
  gross: "Gross earnings",
  paye: "PAYE withheld",
  pension: "Employee pension",
  employer_pension: "Employer pension",
  nhf: "NHF",
  nhis: "NHIS",
  other_deductions: "Other after-tax deductions",
  employer_ecs: "Employer ECS",
  employer_itf: "Employer ITF accrual",
};
export default function PayrollLedgerPanel({
  context,
  revision,
}: {
  context: Context;
  revision: string;
}) {
  const admin = context.user.access === "admin";
  const [period, setPeriod] = useState("2026-12"),
    [employee, setEmployee] = useState(context.user.employee_id),
    [data, setData] = useState<LedgerData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setError("");
    setData(null);
    api(`payroll-ledger?period=${period}`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Unable to load YTD balances.",
          );
      });
    return () => {
      active = false;
    };
  }, [period, revision]);
  async function save(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await api("payroll-ledger", body);
      setData(await api(`payroll-ledger?period=${period}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opening balance failed.");
    } finally {
      setBusy(false);
    }
  }
  const opening = data?.openings.find((o) => o.employee_id === employee);
  const saved: Partial<LedgerAmounts> = opening ? JSON.parse(opening.data) : {};
  return (
    <section className="panel ops-form">
      <h2>
        {admin ? "Payroll YTD reconciliation" : "My year-to-date payroll"}
      </h2>
      <p>
        Opening balances plus approved or paid payroll only. Drafts are
        excluded. PAYE totals represent tax withheld, not confirmed remittance.
        Unrecorded months need review; they do not prove zero income. These
        totals inform review and do not automatically adjust PAYE.
      </p>
      <label>
        YTD through month
        <input
          type="month"
          min="2026-01"
          max="2026-12"
          value={period}
          disabled={busy}
          onChange={(e) => {
            if (e.target.value) setPeriod(e.target.value);
          }}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {admin && (
        <a href={`/api/payroll-ledger?period=${period}&format=csv`} download>
          Download YTD reconciliation CSV (kobo)
        </a>
      )}
      {!data ? (
        <p>Loading year-to-date balances…</p>
      ) : (
        data.rows.map((row) => (
          <details key={row.employee_id} className="panel ops-form">
            <summary>
              {row.name} · gross {amount(row.totals.gross)} · PAYE withheld{" "}
              {amount(row.totals.paye)}
            </summary>
            <dl className="profile-details">
              <div>
                <dt>
                  Opening gross through{" "}
                  {row.opening?.through_period ?? "no imported opening"}
                </dt>
                <dd>{amount(row.opening?.amounts.gross ?? 0)}</dd>
              </div>
              <div>
                <dt>Approved payroll gross</dt>
                <dd>{amount(row.payroll_amounts.gross)}</dd>
              </div>
              <div>
                <dt>YTD deductions</dt>
                <dd>{amount(row.totals.total_deductions)}</dd>
              </div>
              <div>
                <dt>YTD net</dt>
                <dd>{amount(row.totals.net)}</dd>
              </div>
            </dl>
            <p>
              Included payroll:{" "}
              {row.entries.map((e) => `${e.period} (${e.status})`).join(", ") ||
                "None"}
              .
            </p>
            <p>
              Unrecorded months: {row.unrecorded_periods.join(", ") || "None"}.
            </p>
          </details>
        ))
      )}
      {admin && data && (
        <details className="panel ops-form">
          <summary>Opening balances &amp; source review</summary>
          <p>
            Enter cumulative January-to-cutoff totals from the previous payroll
            system or employer. Record these before this employee’s first
            payroll draft here. Opening balances lock after payroll is created;
            discarding all drafts unlocks them if there is no approved history.
            Editing before use preserves an audit trail.
          </p>
          <label>
            Opening balance employee
            <select
              aria-label="Opening balance employee"
              value={employee}
              onChange={(e) => setEmployee(Number(e.target.value))}
            >
              {context.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <form
            key={`${employee}:${opening?.data ?? "new"}:${opening?.through_period ?? ""}:${opening?.reference ?? ""}`}
            onSubmit={(e) => {
              e.preventDefault();
              const body = Object.fromEntries(new FormData(e.currentTarget));
              void save({
                ...body,
                action: "opening",
                employee_id: employee,
                confirmed: body.confirmed === "on",
              });
            }}
          >
            <label>
              Opening balances through month
              <input
                type="month"
                name="through_period"
                min="2026-01"
                max="2026-11"
                defaultValue={opening?.through_period ?? "2026-09"}
                required
              />
            </label>
            <div className="ops-form-grid">
              {Object.entries(openingFields).map(([key, label]) => (
                <label key={key}>
                  {label} to cutoff (₦)
                  <input
                    type="number"
                    name={key}
                    min="0"
                    step="0.01"
                    required
                    defaultValue={
                      (saved[key as keyof LedgerAmounts] ?? 0) / 100
                    }
                  />
                </label>
              ))}
            </div>
            <label>
              Opening balance reviewer name
              <input
                name="reviewed_by"
                maxLength={120}
                required
                defaultValue={opening?.reviewed_by ?? ""}
              />
            </label>
            <label>
              Opening balance source / calculation reference
              <textarea
                name="reference"
                maxLength={1000}
                required
                defaultValue={opening?.reference ?? ""}
              />
            </label>
            <label className="check-label">
              <input type="checkbox" name="confirmed" required />I reviewed
              these source totals and confirm they cover January through the
              cutoff without payroll recorded here. This records my review
              claim.
            </label>
            <button className="primary" disabled={busy}>
              Save opening balances
            </button>{" "}
            {opening && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void save({ action: "clear_opening", employee_id: employee })
                }
              >
                Clear opening balances
              </button>
            )}
          </form>
          {data.events.length > 0 && (
            <details>
              <summary>Opening balance change history</summary>
              <ul>
                {data.events.map((e) => (
                  <li key={e.id}>
                    {dateTime(e.created)} ·{" "}
                    {context.employees.find((p) => p.id === e.employee_id)
                      ?.name ?? "Employee"}{" "}
                    ·{" "}
                    {e.action === "opening"
                      ? "Opening totals recorded"
                      : "Opening totals cleared"}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </details>
      )}
    </section>
  );
}
