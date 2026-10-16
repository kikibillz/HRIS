import {
  calculateCumulativePayroll,
  previewCumulativePayroll,
  type CumulativePrior,
} from "@/lib/payroll-cumulative";
import { createHash } from "node:crypto";
import { priorLedger, totalAmounts, ledgerFields } from "@/lib/payroll-ledger";
import { db } from "@/lib/db";
import { currentUser, requireUser } from "@/lib/auth";
import { employeeInCompany, audit, notify } from "@/lib/tenant";
import {
  defaultPolicy,
  parseSalary,
  calculatePayroll,
  calculatePeriodPayroll,
  parseAdjustment,
  periodDays,
  type PeriodAdjustment,
  payrollVersion,
  sourceUrls,
  type PayrollPolicy,
  type Salary,
} from "@/lib/payroll";
export async function GET() {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  const runs =
    user.access === "admin"
      ? db
          .prepare(
            "SELECT * FROM payroll_runs WHERE company_id=? ORDER BY period DESC",
          )
          .all(user.company_id)
      : [];
  const items = db
    .prepare(
      `SELECT i.id,i.employee_id,i.details,r.id AS run_id,r.period,r.status,COALESCE(json_extract(i.details,'$.name'),e.name) AS name FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id JOIN employees e ON e.id=i.employee_id WHERE r.company_id=? ${user.access === "admin" ? "" : "AND i.employee_id=? AND r.status IN ('Approved','Paid')"} ORDER BY r.period DESC,e.name`,
    )
    .all(
      ...(user.access === "admin"
        ? [user.company_id]
        : [user.company_id, user.employee_id]),
    );
  const salaries =
    user.access === "admin"
      ? db
          .prepare(
            "SELECT c.*,e.name FROM compensation c JOIN employees e ON e.id=c.employee_id JOIN company_employees ce ON ce.employee_id=e.id WHERE ce.company_id=?",
          )
          .all(user.company_id)
      : [];
  const saved = db
    .prepare("SELECT payroll_policy FROM company_settings WHERE company_id=?")
    .get(user.company_id) as { payroll_policy: string } | undefined;
  return Response.json(
    {
      runs,
      items,
      salaries,
      reviews:
        user.access === "admin"
          ? db
              .prepare(
                "SELECT v.*,r.period FROM payroll_reviews v JOIN payroll_runs r ON r.id=v.run_id WHERE r.company_id=? ORDER BY v.id DESC",
              )
              .all(user.company_id)
          : [],
      adjustments:
        user.access === "admin"
          ? db
              .prepare(
                "SELECT * FROM payroll_adjustments WHERE company_id=? ORDER BY period DESC,employee_id",
              )
              .all(user.company_id)
          : [],
      policy: saved ? JSON.parse(saved.payroll_policy) : defaultPolicy,
      version: payrollVersion,
      sources: sourceUrls,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    const b = await request.json();
    if (b.action === "salary") {
      if (
        !Number.isSafeInteger(b.employee_id) ||
        !employeeInCompany(b.employee_id, user.company_id)
      )
        return Response.json({ error: "Employee not found." }, { status: 404 });
      const salary = parseSalary(b);
      db.prepare(
        "INSERT INTO compensation(employee_id,data) VALUES (?,?) ON CONFLICT(employee_id) DO UPDATE SET data=excluded.data,updated=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
      ).run(b.employee_id, JSON.stringify(salary));
      audit(user, "Compensation updated", String(b.employee_id));
      return Response.json({ ok: true });
    }
    if (b.action === "adjustment" || b.action === "clear_adjustment") {
      if (
        !Number.isSafeInteger(b.employee_id) ||
        !employeeInCompany(b.employee_id, user.company_id)
      )
        return Response.json({ error: "Employee not found." }, { status: 404 });
      periodDays(b.period, "2026-01-01");
      const adjustment = parseAdjustment(b);
      db.exec("BEGIN IMMEDIATE");
      try {
        if (
          db
            .prepare(
              "SELECT id FROM payroll_runs WHERE company_id=? AND period=?",
            )
            .get(user.company_id, b.period)
        )
          throw Error(
            "Period inputs are locked while a payroll run exists. Discard its draft before changing inputs; approved payroll is final.",
          );
        if (b.action === "clear_adjustment")
          db.prepare(
            "DELETE FROM payroll_adjustments WHERE company_id=? AND employee_id=? AND period=?",
          ).run(user.company_id, b.employee_id, b.period);
        else
          db.prepare(
            "INSERT INTO payroll_adjustments(company_id,employee_id,period,data,updated_by) VALUES(?,?,?,?,?) ON CONFLICT(company_id,employee_id,period) DO UPDATE SET data=excluded.data,updated_by=excluded.updated_by,updated=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
          ).run(
            user.company_id,
            b.employee_id,
            b.period,
            JSON.stringify(adjustment),
            user.id,
          );
        audit(
          user,
          b.action === "clear_adjustment"
            ? "Payroll period inputs cleared"
            : "Payroll period inputs updated",
          `${b.period}: ${b.employee_id}`,
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return Response.json({ ok: true });
    }
    if (b.action === "policy") {
      const p = b.policy as PayrollPolicy;
      if (
        !p ||
        !["bht", "gross"].includes(p.pension_base) ||
        p.employee_pension_bp + p.employer_pension_bp < 1800 ||
        !["basic", "gross"].includes(p.nhf_base) ||
        ![
          p.employee_pension_bp,
          p.employer_pension_bp,
          p.employer_ecs_bp,
          p.employer_itf_bp,
          p.minimum_wage,
        ].every((x) => Number.isSafeInteger(x) && x >= 0) ||
        p.employee_pension_bp > 3000 ||
        p.employer_pension_bp > 3000 ||
        p.employer_ecs_bp > 500 ||
        p.employer_itf_bp > 500 ||
        p.minimum_wage > 100000000
      )
        throw Error("Invalid payroll policy settings.");
      db.prepare(
        "INSERT INTO company_settings VALUES (?,?) ON CONFLICT(company_id) DO UPDATE SET payroll_policy=excluded.payroll_policy",
      ).run(user.company_id, JSON.stringify(p));
      audit(user, "Payroll policy updated", payrollVersion);
      return Response.json({ ok: true });
    }
    const saved = db
      .prepare("SELECT payroll_policy FROM company_settings WHERE company_id=?")
      .get(user.company_id) as { payroll_policy: string } | undefined;
    const policy: PayrollPolicy = saved
      ? JSON.parse(saved.payroll_policy)
      : defaultPolicy;
    if (b.action === "preview_cumulative") {
      if (
        !Number.isSafeInteger(b.employee_id) ||
        !employeeInCompany(b.employee_id, user.company_id)
      )
        return Response.json({ error: "Employee not found." }, { status: 404 });
      const employee = db
        .prepare(
          "SELECT e.joined,c.data FROM employees e JOIN compensation c ON c.employee_id=e.id WHERE e.id=?",
        )
        .get(b.employee_id) as { joined: string; data: string } | undefined;
      if (!employee || JSON.parse(employee.data).excluded)
        throw Error(
          "Set included employee compensation before previewing cumulative PAYE.",
        );
      const adjustment = parseAdjustment({ ...b, paye_method: "cumulative" });
      const prior = priorLedger(user.company_id, b.employee_id, b.period);
      const result = previewCumulativePayroll(
        JSON.parse(employee.data),
        policy,
        b.period,
        employee.joined,
        adjustment,
        prior,
      );
      return Response.json(
        {
          paye: result.paye,
          net: result.net,
          working: result.working,
          blockers: result.blockers,
          ready_for_draft: result.ready_for_draft,
          prior,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (b.action === "compare") {
      if (!Array.isArray(b.cases) || !b.cases.length || b.cases.length > 200)
        throw Error("Provide 1–200 accountant reference cases.");
      const fields = [
        "gross",
        "paye",
        "pension",
        "employer_pension",
        "nhf",
        "nhis",
        "total_deductions",
        "net",
        "employer_ecs",
        "employer_itf",
      ] as const;
      const results = b.cases.map(
        (c: {
          name: string;
          input: Record<string, unknown>;
          expected: Record<string, number>;
          period?: string;
          joined?: string;
          adjustment?: Record<string, unknown>;
          prior?: CumulativePrior;
        }) => {
          const actual =
            c.period && c.adjustment?.paye_method === "cumulative"
              ? calculateCumulativePayroll(
                  parseSalary(c.input),
                  policy,
                  c.period,
                  c.joined ?? "2026-01-01",
                  parseAdjustment(c.adjustment),
                  c.prior!,
                )
              : c.period
                ? calculatePeriodPayroll(
                    parseSalary(c.input),
                    policy,
                    c.period,
                    c.joined ?? "2026-01-01",
                    parseAdjustment(c.adjustment ?? {}),
                  )
                : calculatePayroll(parseSalary(c.input), policy);
          if (
            !c.expected ||
            !fields.every(
              (k) => Number.isSafeInteger(c.expected[k]) && c.expected[k] >= 0,
            )
          )
            throw Error(
              "Every case must include expected integer-kobo gross, PAYE, pension, employer pension, NHF, NHIS, total deductions, net, ECS and ITF.",
            );
          const differences = fields
            .filter((k) => actual[k] !== c.expected[k])
            .map((k) => ({
              field: k,
              expected: c.expected[k],
              actual: actual[k],
            }));
          return {
            name: String(c.name).slice(0, 120),
            pass: !differences.length,
            differences,
          };
        },
      );
      audit(
        user,
        "Payroll reference cases compared",
        `${results.filter((r: { pass: boolean }) => r.pass).length}/${results.length}`,
      );
      return Response.json({
        results,
        all_passed: results.every((r: { pass: boolean }) => r.pass),
      });
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      if (b.action === "draft") {
        if (
          typeof b.period !== "string" ||
          !/^2026-(0[1-9]|1[0-2])$/.test(b.period)
        )
          throw Error("This rule version supports 2026 monthly periods only.");
        if (
          db
            .prepare(
              "SELECT id FROM payroll_runs WHERE company_id=? AND (period>? OR (period<? AND status='Draft')) LIMIT 1",
            )
            .get(user.company_id, b.period, b.period)
        )
          throw Error(
            "Create payroll in chronological order. Approve or discard earlier drafts first; later runs prevent backdated payroll so YTD snapshots stay consistent.",
          );
        const staff = db
          .prepare(
            "SELECT e.id,e.name,e.joined,c.data FROM employees e JOIN company_employees ce ON ce.employee_id=e.id LEFT JOIN compensation c ON c.employee_id=e.id WHERE ce.company_id=? AND e.status='Active'",
          )
          .all(user.company_id) as {
          id: number;
          name: string;
          data: string | null;
          joined: string;
        }[];
        if (!staff.length) throw Error("Import or add staff first.");
        const periodEnd = new Date(
          Date.UTC(
            Number(String(b.period).slice(0, 4)),
            Number(String(b.period).slice(5, 7)),
            0,
          ),
        )
          .toISOString()
          .slice(0, 10);
        const included = staff.filter((e) => e.joined <= periodEnd);
        const missing = included.filter((e) => !e.data);
        if (missing.length)
          throw Error(
            `Set compensation or explicitly exclude: ${missing.map((e) => e.name).join(", ")}`,
          );
        const eligible = included.filter(
          (e) => !(JSON.parse(e.data!) as Salary).excluded,
        );
        if (!eligible.length)
          throw Error("No employees are included in payroll.");
        const run = Number(
          db
            .prepare(
              "INSERT INTO payroll_runs(company_id,period,policy,created_by) VALUES (?,?,?,?)",
            )
            .run(
              user.company_id,
              b.period,
              JSON.stringify({ ...policy, version: payrollVersion }),
              user.id,
            ).lastInsertRowid,
        );
        for (const e of eligible) {
          const row = db
            .prepare(
              "SELECT data FROM payroll_adjustments WHERE company_id=? AND employee_id=? AND period=?",
            )
            .get(user.company_id, e.id, b.period) as
            { data: string } | undefined;
          const adjustment: PeriodAdjustment = row
            ? JSON.parse(row.data)
            : parseAdjustment({});
          let details;
          const prior = priorLedger(user.company_id, e.id, b.period);
          try {
            details =
              adjustment.paye_method === "cumulative"
                ? calculateCumulativePayroll(
                    JSON.parse(e.data!),
                    policy,
                    b.period,
                    e.joined,
                    adjustment,
                    prior,
                  )
                : calculatePeriodPayroll(
                    JSON.parse(e.data!),
                    policy,
                    b.period,
                    e.joined,
                    adjustment,
                  );
          } catch (error) {
            throw Error(
              `${e.name}: ${error instanceof Error ? error.message : "Invalid period inputs"}`,
            );
          }
          const safePrior = {
            ...prior,
            opening: prior.opening
              ? {
                  id: prior.opening.id,
                  through_period: prior.opening.through_period,
                  amounts: prior.opening.amounts,
                }
              : null,
          };
          const ytdAfter = totalAmounts(
            Object.fromEntries(
              ledgerFields.map((k) => [k, prior.totals[k] + details[k]]),
            ),
          );
          db.prepare(
            "INSERT INTO payroll_items(run_id,employee_id,details) VALUES (?,?,?)",
          ).run(
            run,
            e.id,
            JSON.stringify({
              ...details,
              name: e.name,
              ytd_before: safePrior,
              ytd_after: ytdAfter,
            }),
          );
        }
        audit(user, "Payroll draft created", String(run));
      } else {
        const run = db
          .prepare("SELECT * FROM payroll_runs WHERE id=? AND company_id=?")
          .get(Number(b.run_id), user.company_id) as
          { id: number; status: string; period: string } | undefined;
        if (!run) throw Error("Payroll run not found.");
        if (b.action === "discard") {
          if (run.status !== "Draft")
            throw Error("Only draft payroll can be discarded.");
          db.prepare("DELETE FROM payroll_items WHERE run_id=?").run(run.id);
          db.prepare("DELETE FROM payroll_runs WHERE id=?").run(run.id);
          audit(user, "Payroll draft discarded", String(run.id));
        } else if (b.action === "approve") {
          if (run.status !== "Draft" || b.reviewed !== true)
            throw Error(
              "Review the calculation breakdown and explicitly confirm before approving.",
            );
          db.prepare(
            "UPDATE payroll_runs SET status='Approved' WHERE id=?",
          ).run(run.id);
          const people = db
            .prepare("SELECT employee_id FROM payroll_items WHERE run_id=?")
            .all(run.id) as { employee_id: number }[];
          for (const e of people)
            notify(
              e.employee_id,
              "Payslip available",
              `Your ${run.period} payslip is available in Payroll & payslips.`,
            );
          audit(user, "Payroll approved", String(run.id));
        } else if (b.action === "record_review") {
          if (!["Approved", "Paid"].includes(run.status))
            throw Error(
              "Record external review evidence against released payroll; draft inputs can still change.",
            );
          const reviewedBy = String(b.reviewed_by ?? "").trim(),
            reference = String(b.reference ?? "").trim(),
            notes = String(b.notes ?? "").trim();
          if (
            !reviewedBy ||
            reviewedBy.length > 120 ||
            !reference ||
            reference.length > 1000 ||
            notes.length > 2000 ||
            b.confirmed !== true
          )
            throw Error(
              "Provide the reviewer's name, evidence reference and explicit confirmation that this records an external review claim.",
            );
          const frozen = db
            .prepare("SELECT period,policy FROM payroll_runs WHERE id=?")
            .get(run.id);
          const items = db
            .prepare(
              "SELECT employee_id,details FROM payroll_items WHERE run_id=? ORDER BY employee_id",
            )
            .all(run.id);
          const snapshot_hash = createHash("sha256")
            .update(JSON.stringify({ run: frozen, items }))
            .digest("hex");
          if (
            db
              .prepare("SELECT id FROM payroll_reviews WHERE run_id=?")
              .get(run.id)
          )
            throw Error(
              "This released payroll already has an immutable review record.",
            );
          db.prepare(
            "INSERT INTO payroll_reviews(run_id,reviewed_by,reference,notes,snapshot_hash,recorded_by) VALUES(?,?,?,?,?,?)",
          ).run(run.id, reviewedBy, reference, notes, snapshot_hash, user.id);
          audit(user, "External payroll review recorded", String(run.id));
        } else if (b.action === "record_payment") {
          if (
            run.status !== "Approved" ||
            typeof b.reference !== "string" ||
            !b.reference.trim() ||
            b.reference.length > 200
          )
            throw Error(
              "Record a bank reference for an approved, unpaid payroll run.",
            );
          db.prepare(
            "INSERT INTO payments(run_id,reference,paid_on,created_by) VALUES (?,?,?,?)",
          ).run(run.id, b.reference.trim(), new Date().toISOString(), user.id);
          db.prepare("UPDATE payroll_runs SET status='Paid' WHERE id=?").run(
            run.id,
          );
          audit(
            user,
            "External payment recorded",
            `${run.id}: ${b.reference.trim()}`,
          );
        } else throw Error("Invalid payroll action.");
      }
      db.exec("COMMIT");
      return Response.json({ ok: true });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch (e) {
    return Response.json(
      {
        error: String(e).includes("UNIQUE")
          ? "A payroll already exists for this period. Discard its draft before recalculating."
          : e instanceof Error
            ? e.message
            : "Payroll action failed.",
      },
      { status: 400 },
    );
  }
}
