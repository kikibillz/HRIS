import { db } from "./db";
import { csv } from "./csv";
import { settlementSummary } from "./payroll-settlements";
export const exportFields = [
  "beneficiary",
  "bank",
  "bank_code",
  "account_number",
  "amount",
  "currency",
  "reference",
  "narration",
] as const;
export const profileFields = [
  "bank",
  "bank_account",
  "bank_code",
  "tax_id",
  "pension_id",
  "nhf_id",
  "tax_authority",
] as const;
export const employerFields = [
  "tax_id",
  "pension_reference",
  "nhf_reference",
  "nhis_reference",
  "ecs_reference",
  "itf_reference",
] as const;
export const defaultExportSettings = {
  columns: [
    { header: "Beneficiary", field: "beneficiary" },
    { header: "Bank", field: "bank" },
    { header: "Account number", field: "account_number" },
    { header: "Amount NGN", field: "amount" },
    { header: "Currency", field: "currency" },
    { header: "Reference", field: "reference" },
  ],
  employer: Object.fromEntries(employerFields.map((k) => [k, ""])),
};
export type ExportSettings = typeof defaultExportSettings;
export function parseExportSettings(
  b: Record<string, unknown>,
): ExportSettings {
  const columns = b.columns as { header: string; field: string }[],
    employer = b.employer as Record<string, unknown>;
  if (
    !Array.isArray(columns) ||
    columns.length < 3 ||
    columns.length > 12 ||
    columns.some(
      (c) =>
        !c ||
        typeof c.header !== "string" ||
        !c.header.trim() ||
        c.header.length > 80 ||
        /^[=+\-@\t\r\n]/.test(c.header.trim()) ||
        !exportFields.includes(c.field as (typeof exportFields)[number]),
    ) ||
    new Set(columns.map((c) => c.header.trim())).size !== columns.length ||
    !["beneficiary", "account_number", "amount"].every((f) =>
      columns.some((c) => c.field === f),
    )
  )
    throw Error(
      "Provide 3–12 unique column headers with allowed fields, including beneficiary, account_number and amount.",
    );
  if (!employer || typeof employer !== "object")
    throw Error("Provide employer references.");
  const values = Object.fromEntries(
    employerFields.map((k) => {
      const v = employer[k] ?? "";
      if (typeof v !== "string" || v.length > 120)
        throw Error("Employer references must be text up to 120 characters.");
      return [k, v.trim()];
    }),
  );
  return {
    columns: columns.map((c) => ({ header: c.header.trim(), field: c.field })),
    employer: values,
  };
}
export function exportSettings(company: number): ExportSettings {
  const r = db
    .prepare("SELECT data FROM payroll_export_settings WHERE company_id=?")
    .get(company) as { data: string } | undefined;
  return r ? JSON.parse(r.data) : defaultExportSettings;
}
const naira = (kobo: number) =>
  `${Math.floor(kobo / 100)}.${String(kobo % 100).padStart(2, "0")}`;
export function preparePayrollExport(
  company: number,
  runId: number,
  kind: string,
) {
  if (!["bank", "statutory"].includes(kind))
    throw Error("Choose bank or statutory export.");
  const summary = settlementSummary(company, runId),
    settings = exportSettings(company);
  const items = db
    .prepare(
      "SELECT i.employee_id,i.details,e.name FROM payroll_items i JOIN employees e ON e.id=i.employee_id WHERE i.run_id=? ORDER BY i.employee_id",
    )
    .all(runId) as { employee_id: number; details: string; name: string }[];
  const profiles = db
    .prepare(
      "SELECT employee_id,data,reference FROM payroll_export_profiles WHERE company_id=? AND run_id=?",
    )
    .all(company, runId) as {
    employee_id: number;
    data: string;
    reference: string;
  }[];
  const errors: string[] = [];
  const staff = items.map((i) => {
    const frozen = JSON.parse(i.details),
      override = profiles.find((p) => p.employee_id === i.employee_id);
    return {
      employee_id: i.employee_id,
      name: frozen.name ?? i.name,
      frozen,
      routing: {
        ...Object.fromEntries(
          profileFields.map((k) => [k, String(frozen[k] ?? "")]),
        ),
        ...(override ? JSON.parse(override.data) : {}),
      },
      routing_reference: override?.reference ?? "Frozen payroll identifiers",
    };
  });
  for (const s of staff) {
    if (
      ![
        "gross",
        "net",
        "paye",
        "pension",
        "employer_pension",
        "nhf",
        "nhis",
        "employer_ecs",
        "employer_itf",
      ].every((k) => Number.isSafeInteger(s.frozen[k]) && s.frozen[k] >= 0)
    )
      errors.push(
        `${s.name}: frozen payroll amounts are incomplete or invalid; review the original record externally.`,
      );
  }
  const files: Record<string, string> = {};
  if (kind === "bank") {
    const rows = staff
      .filter(
        (s) =>
          summary.salaries.find((x) => x.employee_id === s.employee_id)!
            .outstanding > 0,
      )
      .map((s) => {
        const outstanding = summary.salaries.find(
          (x) => x.employee_id === s.employee_id,
        )!.outstanding;
        if (!s.routing.bank || !/^\d{10}$/.test(s.routing.bank_account))
          errors.push(`${s.name}: bank and 10-digit account number required.`);
        if (
          settings.columns.some((c) => c.field === "bank_code") &&
          !s.routing.bank_code
        )
          errors.push(`${s.name}: bank code required by this template.`);
        const values: Record<string, string> = {
          beneficiary: s.name,
          bank: s.routing.bank,
          bank_code: s.routing.bank_code,
          account_number: s.routing.bank_account,
          amount: naira(outstanding),
          currency: "NGN",
          reference: `HRIS-${runId}-${s.employee_id}-${outstanding}`,
          narration: `Salary ${summary.run.period}`,
        };
        return Object.fromEntries(
          settings.columns.map((c) => [c.header, values[c.field]]),
        );
      });
    if (!rows.length)
      errors.push("No outstanding salary amounts remain to export.");
    files["bank-schedule.csv"] = csv(rows);
  } else {
    for (const o of summary.obligations) {
      if (o.due <= 0) continue;
      const requiredKey = o.key === "paye" ? "tax_id" : `${o.key}_reference`;
      if (!settings.employer[requiredKey])
        errors.push(`Employer ${o.label} reference required.`);
    }
    for (const s of staff) {
      if (s.frozen.paye > 0 && (!s.routing.tax_id || !s.routing.tax_authority))
        errors.push(
          `${s.name}: Tax ID and resident tax authority required for PAYE.`,
        );
      if (
        s.frozen.pension + s.frozen.employer_pension > 0 &&
        !s.routing.pension_id
      )
        errors.push(`${s.name}: pension identifier required.`);
      if (s.frozen.nhf > 0 && !s.routing.nhf_id)
        errors.push(`${s.name}: NHF identifier required.`);
    }
    files["paye.csv"] = csv(
      staff.map((s) => ({
        period: summary.run.period,
        employee_id: s.employee_id,
        name: s.name,
        tax_id: s.routing.tax_id,
        tax_authority: s.routing.tax_authority,
        gross_ngn: naira(s.frozen.gross),
        paye_ngn: naira(s.frozen.paye),
      })),
    );
    files["contributions.csv"] = csv(
      staff.map((s) => ({
        period: summary.run.period,
        employee_id: s.employee_id,
        name: s.name,
        pension_id: s.routing.pension_id,
        nhf_id: s.routing.nhf_id,
        employee_pension_ngn: naira(s.frozen.pension),
        employer_pension_ngn: naira(s.frozen.employer_pension),
        nhf_ngn: naira(s.frozen.nhf),
        nhis_ngn: naira(s.frozen.nhis),
        employer_ecs_ngn: naira(s.frozen.employer_ecs),
        employer_itf_accrual_ngn: naira(s.frozen.employer_itf),
      })),
    );
    files["obligations.csv"] = csv(
      summary.obligations.map((o) => ({
        period: summary.run.period,
        obligation: o.label,
        calculated_ngn: naira(o.due),
        recorded_paid_ngn: naira(o.settled),
        outstanding_ngn: naira(o.outstanding),
      })),
    );
    files["receipts.csv"] = csv(
      summary.records.map((r) => ({
        obligation: r.obligation,
        employee_id: r.employee_id,
        amount_ngn: naira(r.amount),
        reference: r.reference,
        paid_on: r.paid_on,
        voided_at: r.voided_at,
        void_reason: r.void_reason,
        note: r.note,
      })),
    );
  }
  files["README.txt"] =
    `HRIS ${summary.run.period} ${kind} preparation pack.\nAmounts in CSV files are NGN with two decimal places. Account and identifier columns must be imported as text to preserve leading zeros.\nBank schedule covers recorded outstanding net pay only. It does not reserve funds or detect unrecorded external payments; recheck balances before upload.\nTemplates are configurable and not certified for any bank/authority portal. Confirm the exact required upload format externally.\nStatutory schedules use full frozen payroll liabilities, not just unpaid amounts; receipts are separate. ITF is a monthly accrual. No filing, transfer or remittance is performed by exporting.\nSource references/identifiers are administrator supplied and not independently verified.\n`;
  return {
    errors,
    files,
    summary,
    settings,
    staff: staff.map((s) => ({
      employee_id: s.employee_id,
      name: s.name,
      routing: s.routing,
      reference: s.routing_reference,
    })),
    kind,
    run_id: runId,
    period: summary.run.period,
  };
}
