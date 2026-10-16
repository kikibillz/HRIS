"use client";
import { useState, useRef } from "react";
import { api, amount, type Context } from "./types";
import type { PeriodAdjustment } from "@/lib/payroll";
export type AdjustmentRow = {
  employee_id: number;
  period: string;
  data: string;
};
export default function PayrollAdjustments({
  context,
  rows,
  busy,
  action,
}: {
  context: Context;
  rows: AdjustmentRow[];
  busy: boolean;
  action: (body: unknown) => Promise<void>;
}) {
  const [employee, setEmployee] = useState(context.user.employee_id);
  const [preview, setPreview] = useState<{
    paye: number;
    net: number;
    working: {
      cumulative_tax: number;
      previous_paye: number;
      refund_due: number;
    };
    blockers: string[];
    ready_for_draft: boolean;
  } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const generation = useRef(0);
  function invalidatePreview() {
    generation.current++;
    setPreview(null);
    setPreviewError("");
  }
  async function previewCalculation(form: HTMLFormElement) {
    const input = Object.fromEntries(new FormData(form));
    if (input.paye_method !== "cumulative") {
      setPreviewError("Select cumulative PAYE before previewing.");
      return;
    }
    const current = ++generation.current;
    setPreviewBusy(true);
    setPreviewError("");
    try {
      const result = await api("payroll", {
        ...input,
        action: "preview_cumulative",
        employee_id: employee,
        period,
        history_confirmed: input.history_confirmed === "on",
        minimum_wage_exempt: input.minimum_wage_exempt === "on",
      });
      if (generation.current === current) setPreview(result);
    } catch (e) {
      if (generation.current === current)
        setPreviewError(
          e instanceof Error ? e.message : "Unable to preview cumulative PAYE.",
        );
    } finally {
      setPreviewBusy(false);
    }
  }
  const [period, setPeriod] = useState("2026-10");
  const row = rows.find(
    (r) => r.employee_id === employee && r.period === period,
  );
  const saved: Partial<PeriodAdjustment> = row ? JSON.parse(row.data) : {};
  const fields = {
    bonus: "One-off bonus",
    pensionable_bonus: "Pensionable part of bonus (BHT policy only)",
    one_off_deduction: "One-off after-tax deduction",
    reviewed_paye: "Reviewed total PAYE for this month",
  };
  return (
    <details className="panel ops-form">
      <summary>Period adjustments &amp; partial-month PAYE</summary>
      <p>
        Mid-month starters receive recurring earnings for inclusive calendar
        days from their start date. Each earning component is rounded
        separately. Bonuses are added once. NHIS and recurring after-tax
        deductions stay at their configured monthly amounts.
      </p>
      <p>
        Bonuses and partial months use a reviewed PAYE amount or explicitly
        selected cumulative mode, with a calculation reference. Check prior
        employment income, tax already paid, reliefs and cumulative-method
        applicability with your accountant. Zero reviewed PAYE is accepted only
        when entered explicitly with a note. These inputs do not certify
        accountant approval.
      </p>
      <div className="ops-form-grid">
        <label>
          Adjustment employee
          <select
            aria-label="Adjustment employee"
            value={employee}
            onChange={(e) => {
              invalidatePreview();
              setEmployee(Number(e.target.value));
            }}
          >
            {context.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Adjustment month
          <input
            type="month"
            min="2026-01"
            max="2026-12"
            required
            value={period}
            onChange={(e) => {
              invalidatePreview();
              setPeriod(e.target.value);
            }}
          />
        </label>
      </div>
      <form
        key={`${employee}:${period}:${row?.data ?? "new"}`}
        onChange={invalidatePreview}
        onSubmit={(e) => {
          e.preventDefault();
          const input = Object.fromEntries(new FormData(e.currentTarget));
          void action({
            ...input,
            history_confirmed: input.history_confirmed === "on",
            minimum_wage_exempt: input.minimum_wage_exempt === "on",
            action: "adjustment",
            employee_id: employee,
            period,
          });
        }}
      >
        <label>
          PAYE method
          <select
            aria-label="PAYE method"
            name="paye_method"
            defaultValue={saved.paye_method ?? "monthly"}
          >
            <option value="monthly">Standard monthly / reviewed PAYE</option>
            <option value="cumulative">
              Cumulative YTD monthly basis (explicit review)
            </option>
          </select>
        </label>
        <p>
          Cumulative mode annualises YTD eligible income over calendar months
          elapsed, deducts annual reliefs, applies 2026 bands, apportions tax to
          elapsed months and subtracts prior PAYE. It requires complete
          prior-month records, evidence of eligible contributions, and
          accountant review of this method. Leave reviewed PAYE blank in this
          mode.
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            name="history_confirmed"
            defaultChecked={saved.history_confirmed ?? false}
          />
          For cumulative PAYE, I verified complete prior income/tax history and
          eligible contribution/remittance evidence against the calculation
          reference below.
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            name="minimum_wage_exempt"
            defaultChecked={saved.minimum_wage_exempt ?? false}
          />
          For cumulative PAYE, minimum-wage exemption is confirmed applicable
          with supporting evidence.
        </label>
        <div className="ops-form-grid">
          {Object.entries(fields).map(([k, label]) => (
            <label key={k}>
              {label} (₦)
              <input
                name={k}
                type="number"
                min="0"
                step="0.01"
                defaultValue={
                  k === "reviewed_paye" && saved.reviewed_paye == null
                    ? ""
                    : Number(saved[k as keyof PeriodAdjustment] ?? 0) / 100
                }
              />
            </label>
          ))}
        </div>
        <label>
          PAYE review note / calculation reference
          <textarea
            name="review_note"
            maxLength={1000}
            defaultValue={saved.review_note ?? ""}
            placeholder="Calculation reference, reviewed by, prior income/tax evidence, and assumptions"
          />
        </label>
        <p>
          For the gross pension policy, the whole bonus is pensionable. For BHT,
          enter the pensionable portion explicitly. NHF follows your company’s
          basic/gross policy. Discard a draft before editing its inputs;
          approved periods stay locked.
        </p>
        <button
          type="button"
          className="text-button"
          disabled={busy || previewBusy || !period}
          onClick={(e) => {
            if (e.currentTarget.form)
              void previewCalculation(e.currentTarget.form);
          }}
        >
          Preview cumulative PAYE
        </button>
        {previewError && (
          <p role="alert" className="error">
            {previewError}
          </p>
        )}
        {preview && (
          <div role="status">
            <p>
              Cumulative tax to date: {amount(preview.working.cumulative_tax)} ·
              prior PAYE: {amount(preview.working.previous_paye)} · current
              PAYE: {amount(preview.paye)} · current net: {amount(preview.net)}.
            </p>
            {preview.blockers.map((b) => (
              <p key={b}>{b}</p>
            ))}
            {preview.ready_for_draft && (
              <p>
                Calculation is ready for draft review. Saving inputs
                recalculates from server records when payroll is drafted.
              </p>
            )}
          </div>
        )}
        <button className="primary" disabled={busy || previewBusy || !period}>
          Save period inputs
        </button>{" "}
        {row && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() =>
              void action({
                action: "clear_adjustment",
                employee_id: employee,
                period,
              })
            }
          >
            Clear period inputs
          </button>
        )}
      </form>
      {rows.length > 0 && (
        <ul>
          {rows.map((r) => {
            const a: PeriodAdjustment = JSON.parse(r.data);
            return (
              <li key={`${r.employee_id}:${r.period}`}>
                {r.period} ·{" "}
                {context.employees.find((e) => e.id === r.employee_id)?.name ??
                  "Employee"}{" "}
                · bonus {amount(a.bonus)} · one-off deduction{" "}
                {amount(a.one_off_deduction)} ·{" "}
                {a.paye_method === "cumulative"
                  ? "cumulative YTD PAYE"
                  : a.reviewed_paye === null
                    ? "standard PAYE"
                    : `reviewed PAYE ${amount(a.reviewed_paye)}`}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
