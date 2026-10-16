"use client";
import { useEffect, useState } from "react";
import PayrollSettlements from "./payroll-settlements";
import PayrollLedgerPanel from "./payroll-ledger-panel";
import PayrollReviewForm, { type PayrollReview } from "./payroll-review";
import PayrollAdjustments, { type AdjustmentRow } from "./payroll-adjustments";
import { api, amount, type Context } from "./types";
import {
  defaultPolicy,
  salaryFields,
  type PayrollPolicy,
  type Salary,
} from "@/lib/payroll";
type Item = {
  id: number;
  run_id: number;
  employee_id: number;
  name: string;
  period: string;
  status: string;
  details: string;
};
type Run = { id: number; period: string; status: string };
type Data = {
  runs: Run[];
  reviews: PayrollReview[];
  adjustments: AdjustmentRow[];
  items: Item[];
  salaries: { employee_id: number; name: string; data: string }[];
  policy: PayrollPolicy;
  version: string;
  sources: string[];
};
const labels: Record<string, string> = {
  bonus: "One-off bonus",
  paye: "PAYE",
  pension: "Employee pension",
  nhf: "NHF",
  total_deductions: "Total deductions",
  employer_pension: "Employer pension",
  employer_ecs: "Employer ECS / NSITF",
  employer_itf: "Employer ITF accrual",
  basic: "Basic salary",
  housing: "Housing allowance",
  transport: "Transport allowance",
  other: "Other recurring earnings",
  annual_rent: "Annual rent paid",
  nhis: "Monthly NHIS contribution",
  other_deductions: "Other monthly deductions",
  annual_reliefs: "Other eligible annual reliefs",
};
export default function PayrollPanel({ context }: { context: Context }) {
  const admin = context.user.access === "admin",
    [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [employee, setEmployee] = useState(context.user.employee_id),
    [selected, setSelected] = useState<Item | null>(null),
    [comparison, setComparison] = useState<unknown>(null);
  async function load() {
    try {
      setData(await api("payroll"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load payroll.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function action(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await api("payroll", body);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payroll action failed.");
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <p>{error || "Loading payroll…"}</p>;
  const salary = data.salaries.find((s) => s.employee_id === employee);
  const saved: Partial<Salary> = salary ? JSON.parse(salary.data) : {};
  const policy = data.policy ?? defaultPolicy;
  const slip = selected ? JSON.parse(selected.details) : null;
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {admin && (
        <>
          <section className="panel ops-form">
            <h2>Payroll readiness</h2>
            <p>
              Nigeria 2026 · monthly employment income · {data.version}. Review
              pension applicability, NHF election and basis, relief evidence,
              and employer levies with your accountant. Bonuses and partial
              months use reviewed PAYE inputs or explicitly selected cumulative
              mode. Cumulative mode requires complete history and evidence
              confirmation. Retroactive corrections remain outside this version.
            </p>
            <p>
              {data.salaries.length} employee compensation records configured.
              Every active employee needs compensation or an explicit payroll
              exclusion.
            </p>
            <a href="/payroll-review.xlsx" download>
              Download calculation review workbook
            </a>{" "}
            ·{" "}
            <a href="/payroll-reference-cases.json" download>
              Download reference test cases
            </a>{" "}
            ·{" "}
            <a href="/payroll-period-cases.json" download>
              Download reviewed-period test cases
            </a>{" "}
            ·{" "}
            <a href="/payroll-cumulative-cases.json" download>
              Download cumulative test cases
            </a>
          </section>
          <details className="panel ops-form">
            <summary>Compensation &amp; payroll exclusions</summary>
            <label>
              Employee
              <select
                aria-label="Employee"
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
              key={employee + String(salary?.data)}
              onSubmit={(e) => {
                e.preventDefault();
                const b = Object.fromEntries(new FormData(e.currentTarget));
                void action({
                  ...b,
                  action: "salary",
                  employee_id: employee,
                  pension: b.pension === "true",
                  nhf: b.nhf === "true",
                  excluded: b.excluded === "true",
                });
              }}
            >
              <div className="ops-form-grid">
                {salaryFields.map((k) => (
                  <label key={k}>
                    {labels[k]} (₦)
                    <input
                      name={k}
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={(saved[k] ?? 0) / 100}
                    />
                  </label>
                ))}
                {["pension", "nhf", "excluded"].map((k) => (
                  <label key={k}>
                    {k === "pension"
                      ? "Pension applicable"
                      : k === "nhf"
                        ? "NHF opted in / applicable"
                        : "Exclude from payroll"}
                    <select
                      aria-label={
                        k === "pension"
                          ? "Pension applicable"
                          : k === "nhf"
                            ? "NHF opted in / applicable"
                            : "Exclude from payroll"
                      }
                      name={k}
                      defaultValue={String(
                        saved[k as keyof Salary] ?? k === "pension",
                      )}
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </label>
                ))}
                {["bank", "bank_account", "tax_id", "pension_id", "nhf_id"].map(
                  (k) => (
                    <label key={k}>
                      {k.replaceAll("_", " ")}
                      <input
                        name={k}
                        defaultValue={String(saved[k as keyof Salary] ?? "")}
                        maxLength={120}
                      />
                    </label>
                  ),
                )}
              </div>
              <button className="primary" disabled={busy}>
                Save compensation
              </button>
            </form>
          </details>
          <PayrollAdjustments
            context={context}
            rows={data.adjustments}
            busy={busy}
            action={action}
          />
          <details className="panel ops-form">
            <summary>Statutory settings and applicability</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const b = Object.fromEntries(new FormData(e.currentTarget));
                void action({
                  action: "policy",
                  policy: {
                    pension_base: b.pension_base,
                    nhf_base: b.nhf_base,
                    employee_pension_bp: Math.round(
                      Number(b.employee_pension_bp) * 100,
                    ),
                    employer_pension_bp: Math.round(
                      Number(b.employer_pension_bp) * 100,
                    ),
                    employer_ecs_bp: Math.round(
                      Number(b.employer_ecs_bp) * 100,
                    ),
                    employer_itf_bp: Math.round(
                      Number(b.employer_itf_bp) * 100,
                    ),
                    minimum_wage: Math.round(Number(b.minimum_wage) * 100),
                  },
                });
              }}
            >
              <div className="ops-form-grid">
                <label>
                  Pensionable emoluments
                  <select
                    name="pension_base"
                    defaultValue={policy.pension_base ?? "bht"}
                  >
                    <option value="bht">Basic + housing + transport</option>
                    <option value="gross">All gross earnings</option>
                  </select>
                </label>
                <label>
                  NHF calculation basis
                  <select name="nhf_base" defaultValue={policy.nhf_base}>
                    <option value="basic">Basic salary</option>
                    <option value="gross">Gross salary</option>
                  </select>
                </label>
                {[
                  "employee_pension_bp",
                  "employer_pension_bp",
                  "employer_ecs_bp",
                  "employer_itf_bp",
                ].map((k) => (
                  <label key={k}>
                    {k.replaceAll("_bp", "").replaceAll("_", " ")} (%)
                    <input
                      name={k}
                      type="number"
                      min={0}
                      max={30}
                      step="0.01"
                      defaultValue={
                        (policy[k as keyof PayrollPolicy] as number) / 100
                      }
                    />
                  </label>
                ))}
                <label>
                  Monthly minimum wage exemption threshold (₦)
                  <input
                    name="minimum_wage"
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={policy.minimum_wage / 100}
                  />
                </label>
              </div>
              <p>
                ITF defaults to 0%; set the applicable employer rate after
                confirming eligibility. Employer levies are employer costs,
                never employee deductions.
              </p>
              <button className="primary" disabled={busy}>
                Save statutory settings
              </button>
            </form>
          </details>
          <details className="panel ops-form">
            <summary>Compare accountant reference cases</summary>
            <p>
              Upload JSON cases with expected integer-kobo results. The app
              reports every difference; it does not label the supplied cases
              accountant-approved.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                setBusy(true);
                try {
                  const f = new FormData(e.currentTarget).get("cases");
                  if (!(f instanceof File))
                    throw Error("Choose a JSON case file.");
                  const cases = JSON.parse(await f.text());
                  setComparison(
                    await api("payroll", { action: "compare", cases }),
                  );
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Invalid case file.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Reference cases
                <input
                  type="file"
                  name="cases"
                  accept=".json,application/json"
                  required
                />
              </label>
              <button className="primary" disabled={busy}>
                Compare results
              </button>
            </form>
            {comparison !== null && (
              <pre className="ops-code">
                {JSON.stringify(comparison, null, 2)}
              </pre>
            )}
          </details>
          <section className="panel ops-form">
            <h2>Create monthly payroll</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action({
                  action: "draft",
                  period: new FormData(e.currentTarget).get("period"),
                });
              }}
            >
              <label>
                Payroll month
                <input
                  type="month"
                  name="period"
                  min="2026-01"
                  max="2026-12"
                  required
                  defaultValue="2026-10"
                />
              </label>
              <button className="primary" disabled={busy}>
                Calculate draft payroll
              </button>
            </form>
          </section>
          {data.runs.map((run) => (
            <section className="panel ops-form" key={run.id}>
              <div className="section-head">
                <h2>{run.period} payroll</h2>
                <span className="dept-tag">{run.status}</span>
              </div>
              <p>
                {data.items.filter((i) => i.run_id === run.id).length} payslips
                · net{" "}
                {amount(
                  data.items
                    .filter((i) => i.run_id === run.id)
                    .reduce((n, i) => n + JSON.parse(i.details).net, 0),
                )}
              </p>
              {run.status === "Draft" && (
                <>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action({
                        action: "approve",
                        run_id: run.id,
                        reviewed:
                          new FormData(e.currentTarget).get("reviewed") ===
                          "on",
                      });
                    }}
                  >
                    <label className="ops-check">
                      <input type="checkbox" name="reviewed" required />I have
                      reviewed the employee inputs, calculation breakdowns, and
                      applicable statutory settings.
                    </label>
                    <button className="primary" disabled={busy}>
                      Approve and release payslips
                    </button>
                  </form>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void action({ action: "discard", run_id: run.id })
                    }
                  >
                    Discard draft and recalculate
                  </button>
                </>
              )}
              {run.status !== "Draft" && (
                <p>
                  <a
                    className="secondary"
                    href={`/api/reports?type=payroll&run_id=${run.id}`}
                  >
                    {run.status === "Paid"
                      ? "Download archived payroll schedule"
                      : "Download this payroll & remittance schedule"}
                  </a>
                </p>
              )}
              {run.status !== "Draft" && (
                <PayrollReviewForm
                  runId={run.id}
                  review={data.reviews.find((r) => r.run_id === run.id)}
                  busy={busy}
                  action={action}
                />
              )}
              {run.status !== "Draft" && (
                <PayrollSettlements runId={run.id} onChange={load} />
              )}
              {run.status === "Approved" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action({
                      action: "record_payment",
                      run_id: run.id,
                      reference: new FormData(e.currentTarget).get("reference"),
                    });
                  }}
                >
                  <p>
                    Record a payment already made through your bank. This action
                    does not transfer money.
                  </p>
                  <label>
                    Bank payment reference
                    <input name="reference" required maxLength={200} />
                  </label>
                  <button className="primary" disabled={busy}>
                    Record external payment
                  </button>
                </form>
              )}
            </section>
          ))}
          <a className="secondary" href="/api/reports?type=payroll">
            Export approved payroll history
          </a>
        </>
      )}
      <section className="panel ops-form">
        <h2>{admin ? "Payroll calculation breakdowns" : "My payslips"}</h2>
        {!data.items.length && <p>No released payslips yet.</p>}
        <div className="ops-table">
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Employee</th>
                <th>Gross</th>
                <th>PAYE</th>
                <th>Net</th>
                <th>View</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => {
                const d = JSON.parse(i.details);
                return (
                  <tr key={i.id}>
                    <td>
                      {i.period} · {i.status}
                    </td>
                    <td>{i.name}</td>
                    <td>{amount(d.gross)}</td>
                    <td>{amount(d.paye)}</td>
                    <td>{amount(d.net)}</td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => setSelected(i)}
                      >
                        View payslip
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <PayrollLedgerPanel
        context={context}
        revision={data.runs.map((r) => `${r.id}:${r.status}`).join(",")}
      />
      {selected && (
        <section className="panel ops-form payslip">
          <div className="section-head">
            <h2>
              {context.company.name} · {selected.period} payslip
            </h2>
            <button className="text-button" onClick={() => setSelected(null)}>
              Close payslip
            </button>
          </div>
          <h3>{selected.name}</h3>
          <p>{selected.status} · Amounts in NGN</p>
          {slip.proration && (
            <p>
              Paid calendar days: {slip.proration.paid_days} /{" "}
              {slip.proration.days}. {slip.tax_method}. Review reference:{" "}
              {slip.adjustment.review_note || "Standard recurring calculation"}.
            </p>
          )}
          {slip.ytd_after && (
            <p>
              2026 totals through this payroll: gross{" "}
              {amount(slip.ytd_after.gross)} · PAYE withheld{" "}
              {amount(slip.ytd_after.paye)}. Includes recorded opening balances
              and earlier released payroll; excludes later runs.
            </p>
          )}
          {slip.cumulative && (
            <p>
              Cumulative tax to date: {amount(slip.cumulative.cumulative_tax)} ·
              prior PAYE withheld: {amount(slip.cumulative.previous_paye)} ·
              current PAYE: {amount(slip.paye)}. Method reference:{" "}
              {slip.cumulative.reference}.
            </p>
          )}
          <h3>Earnings</h3>
          <dl className="profile-details">
            {Object.entries(slip.earnings as Record<string, number>).map(
              ([key, value]) => (
                <div key={key}>
                  <dt>{labels[key] ?? key.replaceAll("_", " ")}</dt>
                  <dd>{amount(value)}</dd>
                </div>
              ),
            )}
          </dl>
          <h3>Employee deductions</h3>
          <dl className="profile-details">
            {[
              "paye",
              "pension",
              "nhf",
              "nhis",
              "other_deductions",
              "total_deductions",
            ].map((key) => (
              <div key={key}>
                <dt>
                  {key === "other_deductions"
                    ? "Other deductions (recurring + one-off)"
                    : (labels[key] ?? key.replaceAll("_", " "))}
                </dt>
                <dd>{amount(slip[key])}</dd>
              </div>
            ))}
          </dl>
          <p>
            <strong>
              Gross pay: {amount(slip.gross)} · Net pay: {amount(slip.net)}
            </strong>
          </p>
          {slip.adjustment?.one_off_deduction > 0 && (
            <p>
              Other deductions include a one-off deduction of{" "}
              {amount(slip.adjustment.one_off_deduction)}.
            </p>
          )}
          <h3>Paid by your employer</h3>
          <dl className="profile-details">
            {["employer_pension", "employer_ecs", "employer_itf"].map((key) => (
              <div key={key}>
                <dt>
                  {key === "other_deductions"
                    ? "Other deductions (recurring + one-off)"
                    : (labels[key] ?? key.replaceAll("_", " "))}
                </dt>
                <dd>{amount(slip[key])}</dd>
              </div>
            ))}
          </dl>
          <details>
            <summary>Calculation inputs and tax working</summary>
            <pre className="ops-code">{JSON.stringify(slip, null, 2)}</pre>
          </details>
          <button className="primary" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </section>
      )}
    </>
  );
}
