import { db } from "./db";
import { money, periodDays } from "./payroll";

export const ledgerFields = [
  "gross",
  "paye",
  "pension",
  "employer_pension",
  "nhf",
  "nhis",
  "other_deductions",
  "employer_ecs",
  "employer_itf",
] as const;
export type LedgerAmounts = Record<(typeof ledgerFields)[number], number> & {
  net: number;
  total_deductions: number;
  employer_cost: number;
};
export type Opening = {
  id: number;
  company_id: number;
  employee_id: number;
  year: number;
  through_period: string;
  data: string;
  reviewed_by: string;
  reference: string;
  created_by: number;
  updated: string;
};
export function totalAmounts(input: Record<string, unknown>): LedgerAmounts {
  const values = Object.fromEntries(
    ledgerFields.map((k) => {
      const v = input[k] ?? 0;
      if (!Number.isSafeInteger(v) || Number(v) < 0)
        throw Error(`Invalid integer-kobo ledger amount: ${k}`);
      return [k, Number(v)];
    }),
  ) as LedgerAmounts;
  values.total_deductions =
    values.paye +
    values.pension +
    values.nhf +
    values.nhis +
    values.other_deductions;
  values.net = values.gross - values.total_deductions;
  values.employer_cost =
    values.gross +
    values.employer_pension +
    values.employer_ecs +
    values.employer_itf;
  if (values.net < 0 || !Object.values(values).every(Number.isSafeInteger))
    throw Error(
      "Opening deductions exceed gross or ledger totals are too large.",
    );
  return values;
}
export function parseOpening(input: Record<string, unknown>) {
  if (
    typeof input.through_period !== "string" ||
    !/^2026-(0[1-9]|1[01])$/.test(input.through_period)
  )
    throw Error(
      "Opening balances must end in January–November 2026, before the first payroll here.",
    );
  const reviewed_by = String(input.reviewed_by ?? "").trim(),
    reference = String(input.reference ?? "").trim();
  if (
    !reviewed_by ||
    reviewed_by.length > 120 ||
    !reference ||
    reference.length > 1000 ||
    input.confirmed !== true
  )
    throw Error(
      "Confirm the opening totals and provide the reviewer's name and source calculation reference.",
    );
  const amounts = totalAmounts(
    Object.fromEntries(ledgerFields.map((k) => [k, money(input[k])])),
  );
  return {
    through_period: input.through_period,
    reviewed_by,
    reference,
    amounts,
  };
}
export function openingFor(
  company: number,
  employee: number,
): Opening | undefined {
  return db
    .prepare(
      "SELECT * FROM payroll_openings WHERE company_id=? AND employee_id=? AND year=2026",
    )
    .get(company, employee) as Opening | undefined;
}
export function payrollLedger(
  company: number,
  employee: number,
  through: string,
) {
  periodDays(through, "2026-01-01");
  const opening = openingFor(company, employee);
  const applicable =
    opening && opening.through_period <= through ? opening : null;
  const entries = db
    .prepare(
      "SELECT r.id AS run_id,r.period,r.status,i.details FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id WHERE r.company_id=? AND i.employee_id=? AND r.period BETWEEN '2026-01' AND ? AND r.status IN ('Approved','Paid') ORDER BY r.period",
    )
    .all(company, employee, through) as {
    run_id: number;
    period: string;
    status: string;
    details: string;
  }[];
  if (applicable && entries.some((e) => e.period <= applicable.through_period))
    throw Error(
      "Opening balances overlap recorded payroll; reconciliation is blocked.",
    );
  const opening_amounts = totalAmounts(
    applicable ? JSON.parse(applicable.data) : {},
  );
  const detailAmounts = entries.map((e) => JSON.parse(e.details));
  const payroll_amounts = totalAmounts(
    Object.fromEntries(
      ledgerFields.map((k) => [
        k,
        detailAmounts.reduce((sum, e) => sum + Number(e[k] ?? 0), 0),
      ]),
    ),
  );
  const totals = totalAmounts(
    Object.fromEntries(
      ledgerFields.map((k) => [k, opening_amounts[k] + payroll_amounts[k]]),
    ),
  );
  const unrecorded_periods = Array.from(
    { length: Number(through.slice(5)) },
    (_, i) => `2026-${String(i + 1).padStart(2, "0")}`,
  ).filter(
    (p) =>
      (!applicable || p > applicable.through_period) &&
      !entries.some((e) => e.period === p),
  );
  return {
    year: 2026,
    through_period: through,
    opening: applicable
      ? {
          id: applicable.id,
          through_period: applicable.through_period,
          amounts: opening_amounts,
          reviewed_by: applicable.reviewed_by,
          reference: applicable.reference,
        }
      : null,
    payroll_amounts,
    totals,
    entries: entries.map((e) => ({
      run_id: e.run_id,
      period: e.period,
      status: e.status,
    })),
    unrecorded_periods,
    basis:
      "Opening balances plus Approved/Paid payroll only. PAYE is withheld, not proof of remittance. Unrecorded months are not assumed to have zero income.",
  };
}
export function priorLedger(company: number, employee: number, period: string) {
  periodDays(period, "2026-01-01");
  const opening = openingFor(company, employee);
  if (opening && period <= opening.through_period)
    throw Error("Payroll period overlaps this employee's opening balances.");
  if (period === "2026-01")
    return {
      year: 2026,
      through_period: "2025-12",
      opening: null,
      payroll_amounts: totalAmounts({}),
      totals: totalAmounts({}),
      entries: [],
      unrecorded_periods: [],
      basis: "Start of 2026; no prior 2026 payroll.",
    };
  return payrollLedger(
    company,
    employee,
    `2026-${String(Number(period.slice(5)) - 1).padStart(2, "0")}`,
  );
}
