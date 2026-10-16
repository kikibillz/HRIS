import { db } from "@/lib/db";
import { currentUser, requireUser } from "@/lib/auth";
import { audit } from "@/lib/tenant";
import { money } from "@/lib/payroll";
import {
  settlementSummary,
  statutoryObligations,
} from "@/lib/payroll-settlements";
import { csv } from "@/lib/csv";
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  if (user.access !== "admin")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  try {
    const query = new URL(request.url).searchParams,
      run = Number(query.get("run_id"));
    if (!Number.isSafeInteger(run) || run < 1)
      throw Error("Choose a released payroll run.");
    const result = settlementSummary(user.company_id, run);
    if (query.get("format") === "csv")
      return new Response(
        csv([
          ...result.salaries.map((s) => ({
            period: result.run.period,
            obligation: "salary",
            employee_id: s.employee_id,
            name: s.name,
            due_kobo: s.due,
            recorded_paid_kobo: s.settled,
            outstanding_kobo: s.outstanding,
          })),
          ...result.obligations.map((o) => ({
            period: result.run.period,
            obligation: o.key,
            employee_id: "",
            name: o.label,
            due_kobo: o.due,
            recorded_paid_kobo: o.settled,
            outstanding_kobo: o.outstanding,
          })),
        ]),
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition":
              "attachment; filename=payroll-reconciliation.csv",
            "Cache-Control": "no-store",
          },
        },
      );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Reconciliation failed." },
      { status: 400 },
    );
  }
}
export async function POST(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    const b = await request.json();
    if (!Number.isSafeInteger(b.run_id) || b.run_id < 1)
      throw Error("Choose a released payroll run.");
    db.exec("BEGIN IMMEDIATE");
    try {
      const summary = settlementSummary(user.company_id, b.run_id);
      if (b.action === "record") {
        if (b.confirmed !== true)
          throw Error("Confirm this payment was already made outside the app.");
        const employee = b.obligation === "salary" ? b.employee_id : null;
        const target =
          b.obligation === "salary"
            ? summary.salaries.find((s) => s.employee_id === employee)
            : summary.obligations.find((o) => o.key === b.obligation);
        if (
          !target ||
          (b.obligation !== "salary" &&
            !Object.hasOwn(statutoryObligations, b.obligation))
        )
          throw Error(
            "Payment obligation or employee not found in this payroll.",
          );
        const amount = money(b.amount);
        if (amount <= 0 || amount > target.outstanding)
          throw Error(
            "Amount must be positive and no greater than the outstanding balance.",
          );
        const reference =
            typeof b.reference === "string" ? b.reference.trim() : "",
          note = typeof b.note === "string" ? b.note.trim() : "";
        if (!reference || reference.length > 200 || note.length > 1000)
          throw Error(
            "Provide a unique receipt/transaction reference (up to 200 characters).",
          );
        if (
          typeof b.paid_on !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(b.paid_on) ||
          !Number.isFinite(Date.parse(b.paid_on)) ||
          new Date(b.paid_on).toISOString().slice(0, 10) !== b.paid_on ||
          b.paid_on >
            new Intl.DateTimeFormat("en-CA", {
              timeZone: "Africa/Lagos",
            }).format(new Date())
        )
          throw Error(
            "Provide a valid payment date that is not in the future.",
          );
        if (
          db
            .prepare(
              "SELECT p.id FROM payments p JOIN payroll_runs r ON r.id=p.run_id WHERE r.company_id=? AND p.reference=?",
            )
            .get(user.company_id, reference)
        )
          throw Error("This reference is already recorded for a salary batch.");
        db.prepare(
          "INSERT INTO payroll_settlements(company_id,run_id,obligation,employee_id,amount,reference,paid_on,note,created_by) VALUES(?,?,?,?,?,?,?,?,?)",
        ).run(
          user.company_id,
          b.run_id,
          b.obligation,
          employee,
          amount,
          reference,
          b.paid_on,
          note,
          user.id,
        );
        audit(
          user,
          "External payroll settlement recorded",
          `${b.run_id}: ${b.obligation}: ${reference}`,
        );
      } else if (b.action === "void") {
        const record = summary.records.find(
          (r) => r.id === b.settlement_id && !r.voided_at,
        );
        const reason = typeof b.reason === "string" ? b.reason.trim() : "";
        if (!record || !reason || reason.length > 1000 || b.confirmed !== true)
          throw Error(
            "Select an active receipt and confirm a correction reason (up to 1,000 characters).",
          );
        db.prepare(
          "INSERT INTO payroll_settlement_voids(settlement_id,reason,actor_id) VALUES(?,?,?)",
        ).run(record.id, reason, user.id);
        audit(
          user,
          "External payroll settlement voided",
          `${record.id}: ${reason}`,
        );
      } else throw Error("Invalid reconciliation action.");
      const updated = settlementSummary(user.company_id, b.run_id);
      if (!updated.legacy)
        db.prepare("UPDATE payroll_runs SET status=? WHERE id=?").run(
          updated.salary_outstanding === 0 ? "Paid" : "Approved",
          b.run_id,
        );
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
          ? "This transaction reference is already recorded. Use a unique reference per receipt allocation, including after voiding."
          : e instanceof Error
            ? e.message
            : "Recording failed.",
      },
      { status: 400 },
    );
  }
}
