"use client";
import { useEffect, useState } from "react";
import { api, amount } from "./types";
type Balance = {
  employee_id?: number;
  name?: string;
  key?: string;
  label?: string;
  due: number;
  settled: number;
  outstanding: number;
};
type Receipt = {
  id: number;
  obligation: string;
  employee_id: number | null;
  amount: number;
  reference: string;
  paid_on: string;
  note: string;
  void_reason: string | null;
  voided_at: string | null;
};
type Data = {
  salaries: Balance[];
  obligations: Balance[];
  records: Receipt[];
  legacy: { reference: string } | null;
  salary_outstanding: number;
};
export default function PayrollSettlements({
  runId,
  onChange,
}: {
  runId: number;
  onChange: () => Promise<void>;
}) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [target, setTarget] = useState("paye");
  useEffect(() => {
    let active = true;
    api(`payroll-settlements?run_id=${runId}`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Unable to load receipts.");
      });
    return () => {
      active = false;
    };
  }, [runId]);
  async function action(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await api("payroll-settlements", body);
      setData(await api(`payroll-settlements?run_id=${runId}`));
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recording failed.");
    } finally {
      setBusy(false);
    }
  }
  const choices = data
    ? [
        ...data.obligations.map((o) => ({
          value: o.key!,
          label: o.label!,
          outstanding: o.outstanding,
        })),
        ...data.salaries.map((s) => ({
          value: `salary:${s.employee_id}`,
          label: `Salary: ${s.name}`,
          outstanding: s.outstanding,
        })),
      ]
    : [];
  return (
    <details className="panel ops-form">
      <summary>Payments &amp; statutory remittance reconciliation</summary>
      <p>
        Record payments already made through your bank or authority portal.
        These records do not transfer money or verify receipt by a bank, pension
        fund or authority. Statutory amounts are the frozen payroll
        calculations; ITF is a monthly accrual toward the annual obligation.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <p>Loading reconciliation…</p>
      ) : (
        <>
          <p>
            Salary outstanding: {amount(data.salary_outstanding)}.{" "}
            {data.legacy
              ? `Existing salary-batch reference: ${data.legacy.reference}. Salary amounts are treated as recorded paid; statutory receipts are tracked separately.`
              : "Salary status follows active recorded receipts. Voiding a salary receipt can reopen the outstanding balance."}
          </p>
          <a
            href={`/api/payroll-settlements?run_id=${runId}&format=csv`}
            download
          >
            Download reconciliation CSV (kobo)
          </a>
          <div className="ops-table">
            <table>
              <thead>
                <tr>
                  <th>Obligation</th>
                  <th>Calculated</th>
                  <th>Recorded paid</th>
                  <th>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {choices.map((c) => {
                  const b = c.value.startsWith("salary:")
                    ? data.salaries.find(
                        (s) => `salary:${s.employee_id}` === c.value,
                      )!
                    : data.obligations.find((o) => o.key === c.value)!;
                  return (
                    <tr key={c.value}>
                      <td>{c.label}</td>
                      <td>{amount(b.due)}</td>
                      <td>{amount(b.settled)}</td>
                      <td>{amount(b.outstanding)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <form
            key={`${target}:${data.records.length}`}
            onSubmit={(e) => {
              e.preventDefault();
              const b = Object.fromEntries(new FormData(e.currentTarget));
              void action({
                ...b,
                action: "record",
                run_id: runId,
                obligation: target.startsWith("salary:") ? "salary" : target,
                employee_id: target.startsWith("salary:")
                  ? Number(target.split(":")[1])
                  : null,
                confirmed: b.confirmed === "on",
              });
            }}
          >
            <label>
              Receipt obligation
              <select
                aria-label="Receipt obligation"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                {choices.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Selected outstanding:{" "}
              {amount(
                choices.find((c) => c.value === target)?.outstanding ?? 0,
              )}
              .
            </p>
            <label>
              Receipt amount (₦)
              <input
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
              />
            </label>
            <label>
              Unique receipt allocation reference
              <input name="reference" maxLength={200} required />
            </label>
            <p>
              Use a unique reference for each allocation. For a shared bank
              batch, include the beneficiary or obligation in the allocation
              reference. Voided references stay reserved.
            </p>
            <label>
              Actual payment date
              <input name="paid_on" type="date" required />
            </label>
            <label>
              Receipt evidence / notes
              <textarea name="note" maxLength={1000} />
            </label>
            <label className="check-label">
              <input name="confirmed" type="checkbox" required />I confirm this
              payment was already made outside this app and have checked its
              supporting evidence.
            </label>
            <button className="primary" disabled={busy}>
              Record receipt allocation
            </button>
          </form>
          <h4>Receipt history</h4>
          {!data.records.length && <p>No individual receipts recorded.</p>}
          {data.records.map((r) => (
            <article className="panel ops-form" key={r.id}>
              <p>
                {r.paid_on} ·{" "}
                {r.obligation === "salary"
                  ? `Salary: ${data.salaries.find((s) => s.employee_id === r.employee_id)?.name ?? "Employee"}`
                  : r.obligation.toUpperCase()}{" "}
                · {amount(r.amount)} · {r.reference}
              </p>
              {r.note && <p>{r.note}</p>}
              {r.voided_at ? (
                <p>
                  Voided: {r.void_reason}. The original receipt remains in
                  history.
                </p>
              ) : (
                <details>
                  <summary>Correct this receipt</summary>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const b = Object.fromEntries(
                        new FormData(e.currentTarget),
                      );
                      void action({
                        ...b,
                        action: "void",
                        run_id: runId,
                        settlement_id: r.id,
                        confirmed: b.confirmed === "on",
                      });
                    }}
                  >
                    <label>
                      Correction reason
                      <textarea name="reason" required maxLength={1000} />
                    </label>
                    <label className="check-label">
                      <input name="confirmed" type="checkbox" required />
                      Void this record for reconciliation only; this does not
                      reverse or refund a payment.
                    </label>
                    <button disabled={busy} className="secondary">
                      Void receipt record
                    </button>
                  </form>
                </details>
              )}
            </article>
          ))}
        </>
      )}
    </details>
  );
}
