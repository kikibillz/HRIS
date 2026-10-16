import { createHash } from "node:crypto";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  if (user.access !== "admin")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const period =
    new URL(request.url).searchParams.get("period") ??
    `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
  if (!/^2026-(0[1-9]|1[0-2])$/.test(period))
    return Response.json(
      { error: "Choose a supported 2026 payroll month." },
      { status: 400 },
    );
  const company = user.company_id;
  const roster = db
    .prepare(
      "SELECT e.id,e.name,c.employee_id AS salary FROM employees e JOIN company_employees ce ON ce.employee_id=e.id LEFT JOIN compensation c ON c.employee_id=e.id WHERE ce.company_id=? AND e.status='Active' AND e.joined<=? ORDER BY e.name",
    )
    .all(company, `${period}-31`) as {
    id: number;
    name: string;
    salary: number | null;
  }[];
  const missing = roster.filter((e) => e.salary === null);
  const policy = !!db
    .prepare("SELECT 1 FROM company_settings WHERE company_id=?")
    .get(company);
  const run = db
    .prepare(
      "SELECT id,period,status,policy FROM payroll_runs WHERE company_id=? AND period=?",
    )
    .get(company, period) as
    { id: number; period: string; status: string; policy: string } | undefined;
  const items = run
    ? db
        .prepare(
          "SELECT employee_id,details FROM payroll_items WHERE run_id=? ORDER BY employee_id",
        )
        .all(run.id)
    : [];
  const review = run
    ? (db
        .prepare("SELECT snapshot_hash FROM payroll_reviews WHERE run_id=?")
        .get(run.id) as { snapshot_hash: string } | undefined)
    : undefined;
  const hash = run
    ? createHash("sha256")
        .update(
          JSON.stringify({
            run: { period: run.period, policy: run.policy },
            items,
          }),
        )
        .digest("hex")
    : null;
  const released = !!run && ["Approved", "Paid"].includes(run.status);
  const steps = [
    {
      id: "staff",
      title: "Staff records available",
      complete: roster.length > 0,
      detail: `${roster.length} active staff eligible by this month. Check the roster and import any missing staff.`,
      tab: "import",
    },
    {
      id: "compensation",
      title: "Complete compensation",
      complete: roster.length > 0 && missing.length === 0,
      detail: `${missing.length} eligible staff without saved compensation. Review start dates, salary components, exclusions and opening totals before calculating.`,
      tab: "payroll",
    },
    {
      id: "policy",
      title: "Save statutory settings",
      complete: policy,
      detail: policy
        ? "Company payroll settings have been saved. Verify their applicability with your accountant."
        : "Review and save pension, NHF and other statutory settings for this company.",
      tab: "payroll",
    },
    {
      id: "calculation",
      title: "Calculate this payroll",
      complete: items.length > 0,
      detail: run
        ? `${period}: ${run.status}; ${items.length} calculation snapshots. Saved inputs may differ from this frozen run.`
        : "Calculate a draft and inspect each employee’s deductions and net pay.",
      tab: "payroll",
    },
    {
      id: "release",
      title: "Review and approve",
      complete: released,
      detail:
        "Review the breakdown before approval. Approval releases employees’ payslips; it does not send bank payments.",
      tab: "payroll",
    },
    {
      id: "review",
      title: "Record external calculation review",
      complete: released && !!review && review.snapshot_hash === hash,
      detail:
        review && review.snapshot_hash !== hash
          ? "The saved review does not match the current payroll snapshot. Investigate before relying on it."
          : "Compare with independent accountant calculations, then record the reviewer and evidence against released payroll. This records your review claim, not independent certification.",
      tab: "payroll",
    },
  ];
  return Response.json(
    {
      period,
      steps,
      completed: steps.filter((s) => s.complete).length,
      total: steps.length,
      missing_compensation: missing.map((e) => ({ id: e.id, name: e.name })),
      next: steps.find((s) => !s.complete)?.id ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
