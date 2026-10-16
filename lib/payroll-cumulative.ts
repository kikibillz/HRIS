import {
  calculatePeriodPayroll,
  periodDays,
  type Salary,
  type PayrollPolicy,
  type PeriodAdjustment,
  payrollVersion,
} from "./payroll.ts";
export const cumulativeVersion = "NG-2026-cumulative-monthly-v1";
export type CumulativePrior = {
  through_period: string;
  totals: {
    gross: number;
    paye: number;
    pension: number;
    nhf: number;
    nhis: number;
  };
  unrecorded_periods: string[];
};
const halfUp = (n: bigint, d: bigint) => Number((n + d / 2n) / d);
export function previewCumulativePayroll(
  s: Salary,
  policy: PayrollPolicy,
  period: string,
  joined: string,
  adjustment: PeriodAdjustment,
  prior: CumulativePrior,
) {
  periodDays(period, joined);
  if (!prior || !prior.totals)
    throw Error("Provide cumulative prior-period totals.");
  const month = Number(period.slice(5)),
    expectedPrior =
      month === 1 ? "2025-12" : `2026-${String(month - 1).padStart(2, "0")}`;
  if (
    prior.through_period !== expectedPrior ||
    !Array.isArray(prior.unrecorded_periods) ||
    prior.unrecorded_periods.length
  )
    throw Error(
      "Cumulative PAYE requires complete prior-month history. Record reviewed opening balances before first payroll, or use reviewed PAYE while history is incomplete.",
    );
  if (
    adjustment.paye_method !== "cumulative" ||
    adjustment.history_confirmed !== true ||
    !adjustment.review_note ||
    adjustment.reviewed_paye !== null
  )
    throw Error(
      "Select cumulative PAYE, confirm history and eligible-contribution evidence, provide a method reference, and leave reviewed PAYE blank.",
    );
  for (const key of ["gross", "paye", "pension", "nhf", "nhis"] as const)
    if (!Number.isSafeInteger(prior.totals[key]) || prior.totals[key] < 0)
      throw Error("Invalid cumulative prior amounts.");
  if (
    prior.totals.pension + prior.totals.nhf + prior.totals.nhis >
    prior.totals.gross
  )
    throw Error("Prior eligible deductions exceed gross earnings.");
  const components = calculatePeriodPayroll(s, policy, period, joined, {
    ...adjustment,
    paye_method: "monthly",
    reviewed_paye: 0,
    review_note: "Cumulative component working",
  });
  const gross_ytd = prior.totals.gross + components.gross;
  const eligible_contributions_ytd =
    prior.totals.pension +
    components.pension +
    prior.totals.nhf +
    components.nhf +
    prior.totals.nhis +
    components.nhis;
  const annual_rent_relief = Math.min(
    halfUp(BigInt(s.annual_rent) * 2000n, 10000n),
    50000000,
  );
  // Rational scaling avoids rounding prorated bands or annualised income before tax.
  // Annualised chargeable income = (YTD gross - eligible contributions)*12/month - annual reliefs.
  const reliefs = annual_rent_relief + s.annual_reliefs;
  const taxableScaled =
    BigInt(gross_ytd - eligible_contributions_ytd) * 12n -
    BigInt(reliefs) * BigInt(month);
  let remaining = taxableScaled > 0n ? taxableScaled : 0n,
    taxNumerator = 0n;
  const widths = [80000000, 220000000, 900000000, 1300000000, 2500000000],
    rates = [0, 1500, 1800, 2100, 2300, 2500];
  const bands = rates.map((rate, i) => {
    const width =
      i < widths.length ? BigInt(widths[i]) * BigInt(month) : remaining;
    const used = remaining < width ? remaining : width;
    remaining -= used;
    taxNumerator += used * BigInt(rate);
    return {
      annualised_taxable_scaled: Number(used),
      scale: month,
      rate_bp: rate,
    };
  });
  if (adjustment.minimum_wage_exempt === true) {
    if (
      gross_ytd > policy.minimum_wage * month ||
      s.basic + s.housing + s.transport + s.other > policy.minimum_wage ||
      adjustment.bonus > 0
    )
      throw Error(
        "The claimed minimum-wage exemption conflicts with these earnings. Review eligibility or use reviewed PAYE.",
      );
    taxNumerator = 0n;
  }
  const cumulative_tax = halfUp(taxNumerator, 120000n),
    previous_paye = prior.totals.paye;
  const paye = Math.max(0, cumulative_tax - previous_paye),
    refund_due = Math.max(0, previous_paye - cumulative_tax);
  const total_deductions = components.total_deductions + paye,
    net = components.gross - total_deductions;
  const blockers: string[] = [];
  if (refund_due > 0)
    blockers.push(
      "Prior PAYE exceeds cumulative liability. Review the refund externally and use a reviewed PAYE amount; this engine does not automatically repay tax.",
    );
  if (net < 0)
    blockers.push(
      "Cumulative PAYE and other deductions exceed this month's gross. Review recovery externally; payroll cannot release a negative net payment.",
    );
  const working = {
    version: cumulativeVersion,
    month,
    gross_ytd,
    eligible_contributions_ytd,
    annual_rent_relief,
    annual_other_reliefs: s.annual_reliefs,
    annualised_taxable: halfUp(
      taxableScaled > 0n ? taxableScaled : 0n,
      BigInt(month),
    ),
    cumulative_tax,
    previous_paye,
    paye,
    refund_due,
    minimum_wage_exempt: adjustment.minimum_wage_exempt === true,
    bands,
    method:
      "Annualise eligible YTD income over calendar months elapsed, subtract annual reliefs, apply 2026 bands, apportion tax to elapsed months, round once to kobo, subtract prior PAYE. Method requires accountant review.",
    reference: adjustment.review_note,
  };
  return {
    components,
    paye,
    total_deductions,
    net,
    working,
    blockers,
    ready_for_draft: !blockers.length,
  };
}
export function calculateCumulativePayroll(
  s: Salary,
  policy: PayrollPolicy,
  period: string,
  joined: string,
  adjustment: PeriodAdjustment,
  prior: CumulativePrior,
) {
  const preview = previewCumulativePayroll(
    s,
    policy,
    period,
    joined,
    adjustment,
    prior,
  );
  if (!preview.ready_for_draft) throw Error(preview.blockers.join(" "));
  return {
    ...preview.components,
    paye: preview.paye,
    total_deductions: preview.total_deductions,
    net: preview.net,
    adjustment,
    tax_method:
      "Cumulative YTD monthly basis — explicitly selected and evidence-confirmed",
    cumulative: preview.working,
    version: payrollVersion,
  };
}
