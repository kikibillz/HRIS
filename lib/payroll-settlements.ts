import { db } from "./db";
export const statutoryObligations = {
  paye: "PAYE",
  pension: "Employee + employer pension",
  nhf: "NHF",
  nhis: "NHIS",
  ecs: "Employer ECS / NSITF",
  itf: "Employer ITF accrual",
};
export type Settlement = {
  id: number;
  company_id: number;
  run_id: number;
  obligation: string;
  employee_id: number | null;
  amount: number;
  reference: string;
  paid_on: string;
  note: string;
  created: string;
  void_reason: string | null;
  voided_at: string | null;
};
export function settlementSummary(company: number, runId: number) {
  const run = db
    .prepare(
      "SELECT id,period,status FROM payroll_runs WHERE id=? AND company_id=? AND status IN ('Approved','Paid')",
    )
    .get(runId, company) as
    { id: number; period: string; status: string } | undefined;
  if (!run) throw Error("Released payroll not found.");
  const items = db
    .prepare(
      "SELECT employee_id,details FROM payroll_items WHERE run_id=? ORDER BY employee_id",
    )
    .all(runId) as { employee_id: number; details: string }[];
  const records = db
    .prepare(
      "SELECT s.*,v.reason AS void_reason,v.created AS voided_at FROM payroll_settlements s LEFT JOIN payroll_settlement_voids v ON v.settlement_id=s.id WHERE s.company_id=? AND s.run_id=? ORDER BY s.id DESC",
    )
    .all(company, runId) as Settlement[];
  const legacy = db
    .prepare("SELECT reference,paid_on FROM payments WHERE run_id=?")
    .get(runId) as { reference: string; paid_on: string } | undefined;
  const paid = (obligation: string, employee: number | null) =>
    records
      .filter(
        (r) =>
          r.obligation === obligation &&
          r.employee_id === employee &&
          !r.voided_at,
      )
      .reduce((s, r) => s + r.amount, 0);
  const salaries = items.map((i) => {
    const d = JSON.parse(i.details);
    const settled = legacy ? d.net : paid("salary", i.employee_id);
    return {
      employee_id: i.employee_id,
      name: d.name ?? "Employee",
      due: d.net,
      settled,
      outstanding: d.net - settled,
    };
  });
  const obligations = Object.entries(statutoryObligations).map(
    ([key, label]) => {
      const due = items.reduce((sum, i) => {
        const d = JSON.parse(i.details);
        return (
          sum +
          (key === "pension"
            ? d.pension + d.employer_pension
            : key === "ecs"
              ? d.employer_ecs
              : key === "itf"
                ? d.employer_itf
                : d[key])
        );
      }, 0);
      const settled = paid(key, null);
      return { key, label, due, settled, outstanding: due - settled };
    },
  );
  return {
    run,
    salaries,
    obligations,
    records,
    legacy: legacy ?? null,
    salary_outstanding: salaries.reduce((s, r) => s + r.outstanding, 0),
  };
}
