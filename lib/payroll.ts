// All monetary inputs/outputs are integer kobo; percent rates use basis points.
export const payrollVersion = "NG-2026-cumulative-option-v3";
export const sourceUrls = [
  "https://irs.kg.gov.ng/JRB_2026_PIT_Guidelines_Final.pdf",
  "https://www.nrs.gov.ng/uploads/NIGERIA_TAX_ACT_2025_ef6bb812a5.pdf",
  "https://www.nipc.gov.ng/wp-content/uploads/2025/07/Nigeria-Tax-Act-2025.pdf",
  "https://www.pencom.gov.ng/wp-content/uploads/2023/09/FREQUENTLY-ASKED-QUESTIONS-2023.pdf",
  "https://fmbn.gov.ng/products/nhf-scheme/faqs",
  "https://nsitf.gov.ng/services",
  "https://www.itf.gov.ng/",
];
export function money(input: unknown): number {
  const value = String(input ?? "0").trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value))
    throw Error(
      "Amounts must be non-negative naira with at most two decimal places.",
    );
  const [whole, fraction = ""] = value.split(".");
  return Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
}
export const salaryFields = [
  "basic",
  "housing",
  "transport",
  "other",
  "annual_rent",
  "nhis",
  "other_deductions",
  "annual_reliefs",
] as const;
export type Salary = Record<(typeof salaryFields)[number], number> & {
  pension: boolean;
  nhf: boolean;
  excluded: boolean;
  bank: string;
  bank_account: string;
  tax_id: string;
  pension_id: string;
  nhf_id: string;
};
export type PayrollPolicy = {
  pension_base: "bht" | "gross";
  nhf_base: "basic" | "gross";
  employee_pension_bp: number;
  employer_pension_bp: number;
  employer_ecs_bp: number;
  employer_itf_bp: number;
  minimum_wage: number;
};
export const defaultPolicy: PayrollPolicy = {
  pension_base: "bht",
  nhf_base: "basic",
  employee_pension_bp: 800,
  employer_pension_bp: 1000,
  employer_ecs_bp: 100,
  employer_itf_bp: 0,
  minimum_wage: 7000000,
};
export function parseSalary(body: Record<string, unknown>): Salary {
  const s = Object.fromEntries(
    salaryFields.map((k) => [k, money(body[k])]),
  ) as unknown as Salary;
  s.pension = body.pension !== false && body.pension !== "false";
  s.nhf = body.nhf === true || body.nhf === "true";
  s.excluded = body.excluded === true || body.excluded === "true";
  for (const k of [
    "bank",
    "bank_account",
    "tax_id",
    "pension_id",
    "nhf_id",
  ] as const) {
    s[k] = String(body[k] ?? "").trim();
    if (s[k].length > 120) throw Error("Payroll identifiers are too long.");
  }
  if (s.bank_account && !/^\d{10}$/.test(s.bank_account))
    throw Error("Bank account must contain 10 digits.");
  if (!s.excluded && s.basic + s.housing + s.transport + s.other === 0)
    throw Error(
      "Enter monthly earnings or explicitly exclude this employee from payroll.",
    );
  return s;
}
const rounded = (n: bigint, d: bigint) => Number((n + d / 2n) / d);
const percent = (amount: number, bp: number) =>
  rounded(BigInt(amount) * BigInt(bp), 10000n);
export function calculatePayroll(
  s: Salary,
  policy: PayrollPolicy = defaultPolicy,
) {
  const gross = s.basic + s.housing + s.transport + s.other;
  const pension_base =
    policy.pension_base === "gross" ? gross : s.basic + s.housing + s.transport;
  const pension = s.pension
    ? percent(pension_base, policy.employee_pension_bp)
    : 0;
  const employer_pension = s.pension
    ? percent(pension_base, policy.employer_pension_bp)
    : 0;
  const nhf = s.nhf
    ? percent(policy.nhf_base === "basic" ? s.basic : gross, 250)
    : 0;
  const rent_relief = Math.min(percent(s.annual_rent, 2000), 50000000);
  const annual_taxable = Math.max(
    0,
    (gross - pension - nhf - s.nhis) * 12 - rent_relief - s.annual_reliefs,
  );
  const widths = [
    80000000,
    220000000,
    900000000,
    1300000000,
    2500000000,
    Number.MAX_SAFE_INTEGER,
  ];
  const rates = [0, 1500, 1800, 2100, 2300, 2500];
  let remaining = annual_taxable;
  let taxNumerator = 0n;
  const bands = widths.map((width, i) => {
    const amount = Math.min(remaining, width);
    remaining -= amount;
    taxNumerator += BigInt(amount) * BigInt(rates[i]);
    return { taxable: amount, rate_bp: rates[i] };
  });
  if (gross <= policy.minimum_wage) taxNumerator = 0n;
  const annual_paye = rounded(taxNumerator, 10000n),
    paye = rounded(taxNumerator, 120000n);
  const total_deductions = paye + pension + nhf + s.nhis + s.other_deductions;
  const net = gross - total_deductions;
  if (net < 0) throw Error("Deductions exceed gross pay.");
  const employer_ecs = percent(gross, policy.employer_ecs_bp),
    employer_itf = percent(gross, policy.employer_itf_bp);
  return {
    gross,
    pension_base,
    pension,
    employer_pension,
    nhf,
    nhis: s.nhis,
    rent_relief,
    annual_taxable,
    annual_paye,
    paye,
    other_deductions: s.other_deductions,
    total_deductions,
    net,
    employer_ecs,
    employer_itf,
    employer_cost: gross + employer_pension + employer_ecs + employer_itf,
    bands,
    earnings: {
      basic: s.basic,
      housing: s.housing,
      transport: s.transport,
      other: s.other,
    },
    bank: s.bank,
    bank_account: s.bank_account,
    tax_id: s.tax_id,
    pension_id: s.pension_id,
    nhf_id: s.nhf_id,
    version: payrollVersion,
  };
}

export type PeriodAdjustment = {
  bonus: number;
  pensionable_bonus: number;
  one_off_deduction: number;
  reviewed_paye: number | null;
  review_note: string;
  paye_method?: "monthly" | "cumulative";
  history_confirmed?: boolean;
  minimum_wage_exempt?: boolean;
};
export function parseAdjustment(b: Record<string, unknown>): PeriodAdjustment {
  const bonus = money(b.bonus),
    pensionable_bonus = money(b.pensionable_bonus);
  if (pensionable_bonus > bonus)
    throw Error("Pensionable bonus cannot exceed total bonus.");
  const review_note = String(b.review_note ?? "").trim();
  if (review_note.length > 1000)
    throw Error("Review note must be at most 1,000 characters.");
  const reviewed_paye =
    b.reviewed_paye === null ||
    b.reviewed_paye === undefined ||
    b.reviewed_paye === ""
      ? null
      : money(b.reviewed_paye);
  if (reviewed_paye !== null && !review_note)
    throw Error(
      "A PAYE override requires a review note and calculation reference.",
    );
  const paye_method = b.paye_method ?? "monthly";
  if (
    typeof paye_method !== "string" ||
    !["monthly", "cumulative"].includes(paye_method)
  )
    throw Error("Choose a valid PAYE method.");
  if (
    paye_method === "cumulative" &&
    (reviewed_paye !== null || !review_note || b.history_confirmed !== true)
  )
    throw Error(
      "Cumulative PAYE requires a method/evidence reference, history confirmation, and a blank reviewed PAYE amount.",
    );
  return {
    paye_method: paye_method as "monthly" | "cumulative",
    history_confirmed: b.history_confirmed === true,
    minimum_wage_exempt: b.minimum_wage_exempt === true,
    bonus,
    pensionable_bonus,
    one_off_deduction: money(b.one_off_deduction),
    reviewed_paye,
    review_note,
  };
}
export function periodDays(period: string, joined: string) {
  if (!/^2026-(0[1-9]|1[0-2])$/.test(period))
    throw Error("This rule version supports 2026 monthly periods only.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(joined) ||
    !Number.isFinite(Date.parse(joined)) ||
    new Date(joined).toISOString().slice(0, 10) !== joined
  )
    throw Error("Invalid employment start date.");
  const days = new Date(
    Date.UTC(2026, Number(period.slice(5)), 0),
  ).getUTCDate();
  const start = period + "-01",
    end = period + "-" + String(days).padStart(2, "0");
  const paid_days =
    joined > end
      ? 0
      : joined <= start
        ? days
        : days - Number(joined.slice(8)) + 1;
  return {
    period,
    joined,
    days,
    paid_days,
    basis:
      "Inclusive calendar days; each recurring earning component rounded separately",
  };
}
export function calculatePeriodPayroll(
  s: Salary,
  policy: PayrollPolicy,
  period: string,
  joined: string,
  adjustment: PeriodAdjustment = parseAdjustment({}),
) {
  if (adjustment.paye_method === "cumulative")
    throw Error(
      "Cumulative PAYE must use the cumulative engine with prior history.",
    );
  const proration = periodDays(period, joined);
  if (!proration.paid_days)
    throw Error("Employee starts after this payroll period.");
  if (
    (proration.paid_days < proration.days || adjustment.bonus > 0) &&
    adjustment.reviewed_paye === null
  )
    throw Error(
      "Bonuses and partial months require a reviewed PAYE amount and calculation reference in period adjustments.",
    );
  const earnings = Object.fromEntries(
    (["basic", "housing", "transport", "other"] as const).map((k) => [
      k,
      rounded(
        BigInt(s[k]) * BigInt(proration.paid_days),
        BigInt(proration.days),
      ),
    ]),
  ) as Record<"basic" | "housing" | "transport" | "other", number>;
  // Only ordinary full-month pay uses the fixed-month annualisation. Variable periods
  // use the supplied reviewed PAYE, never an annualised one-off bonus estimate.
  const fixed =
    adjustment.reviewed_paye === null ? calculatePayroll(s, policy) : null;
  const gross =
    Object.values(earnings).reduce((a, b) => a + b, 0) + adjustment.bonus;
  const pension_base =
    policy.pension_base === "gross"
      ? gross
      : earnings.basic +
        earnings.housing +
        earnings.transport +
        adjustment.pensionable_bonus;
  const pension = s.pension
    ? percent(pension_base, policy.employee_pension_bp)
    : 0;
  const employer_pension = s.pension
    ? percent(pension_base, policy.employer_pension_bp)
    : 0;
  const nhf = s.nhf
    ? percent(policy.nhf_base === "basic" ? earnings.basic : gross, 250)
    : 0;
  const paye = adjustment.reviewed_paye ?? fixed!.paye;
  const other_deductions = s.other_deductions + adjustment.one_off_deduction;
  const total_deductions = paye + pension + nhf + s.nhis + other_deductions;
  const net = gross - total_deductions;
  if (net < 0) throw Error("Deductions exceed gross pay.");
  const employer_ecs = percent(gross, policy.employer_ecs_bp),
    employer_itf = percent(gross, policy.employer_itf_bp);
  return {
    ...fixed,
    gross,
    pension_base,
    pension,
    employer_pension,
    nhf,
    nhis: s.nhis,
    paye,
    other_deductions,
    total_deductions,
    net,
    employer_ecs,
    employer_itf,
    employer_cost: gross + employer_pension + employer_ecs + employer_itf,
    earnings: { ...earnings, bonus: adjustment.bonus },
    bank: s.bank,
    bank_account: s.bank_account,
    tax_id: s.tax_id,
    pension_id: s.pension_id,
    nhf_id: s.nhf_id,
    proration,
    adjustment,
    salary_snapshot: s,
    policy_snapshot: policy,
    tax_method:
      adjustment.reviewed_paye === null
        ? "Fixed monthly annualisation"
        : "Reviewed PAYE supplied by payroll administrator; cumulative calculation outside engine",
    version: payrollVersion,
  };
}
