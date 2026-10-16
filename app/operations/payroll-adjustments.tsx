"use client";
import { useState } from "react";
import { amount, type Context } from "./types";
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
        Bonuses and partial months require a reviewed total PAYE and a
        calculation reference. Check prior employment income, tax already paid,
        reliefs and cumulative liability outside this engine. Zero PAYE is
        accepted only when entered explicitly with a note. These inputs do not
        certify accountant approval.
      </p>
      <div className="ops-form-grid">
        <label>
          Adjustment employee
          <select
            aria-label="Adjustment employee"
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
        <label>
          Adjustment month
          <input
            type="month"
            min="2026-01"
            max="2026-12"
            required
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </label>
      </div>
      <form
        key={`${employee}:${period}:${row?.data ?? "new"}`}
        onSubmit={(e) => {
          e.preventDefault();
          void action({
            ...Object.fromEntries(new FormData(e.currentTarget)),
            action: "adjustment",
            employee_id: employee,
            period,
          });
        }}
      >
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
        <button className="primary" disabled={busy || !period}>
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
                {a.reviewed_paye === null
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
