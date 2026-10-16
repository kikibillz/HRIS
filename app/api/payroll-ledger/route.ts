import { db } from "@/lib/db";
import { currentUser, requireUser } from "@/lib/auth";
import { employeeInCompany, audit } from "@/lib/tenant";
import {
  ledgerFields,
  openingFor,
  parseOpening,
  payrollLedger,
} from "@/lib/payroll-ledger";
import { csv } from "@/lib/csv";
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  try {
    const query = new URL(request.url).searchParams,
      through = query.get("period") ?? "2026-12",
      raw = query.get("employee_id"),
      id = raw === null ? null : Number(raw);
    const format = query.get("format");
    if (format === "csv" && user.access !== "admin")
      return Response.json(
        { error: "Administrator access required." },
        { status: 403 },
      );
    if (
      id !== null &&
      (!Number.isSafeInteger(id) ||
        !employeeInCompany(id, user.company_id) ||
        (user.access !== "admin" && id !== user.employee_id))
    )
      return Response.json({ error: "Employee not found." }, { status: 404 });
    const people = db
      .prepare(
        `SELECT e.id,e.name FROM employees e JOIN company_employees ce ON ce.employee_id=e.id WHERE ce.company_id=? ${id !== null || user.access !== "admin" ? "AND e.id=?" : ""} ORDER BY e.name`,
      )
      .all(
        ...(id !== null || user.access !== "admin"
          ? [user.company_id, id ?? user.employee_id]
          : [user.company_id]),
      ) as { id: number; name: string }[];
    const rows = people.map((e) => ({
      employee_id: e.id,
      name: e.name,
      ...payrollLedger(user.company_id, e.id, through),
    }));
    const headers = { "Cache-Control": "no-store" };
    if (format === "csv")
      return new Response(
        csv(
          rows.map((r) => ({
            employee_id: r.employee_id,
            name: r.name,
            through_period: r.through_period,
            opening_through: r.opening?.through_period ?? "",
            payroll_periods: r.entries.map((e) => e.period).join("; "),
            unrecorded_periods: r.unrecorded_periods.join("; "),
            ...Object.fromEntries(
              [...ledgerFields, "net", "total_deductions"].map((k) => [
                `${k}_kobo`,
                r.totals[k as keyof typeof r.totals],
              ]),
            ),
          })),
        ),
        {
          headers: {
            ...headers,
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": "attachment; filename=payroll-ytd-2026.csv",
          },
        },
      );
    // Source review references and the change log stay with company administrators.
    return Response.json(
      {
        rows: rows.map((r) =>
          user.access === "admin"
            ? r
            : {
                ...r,
                opening: r.opening
                  ? {
                      through_period: r.opening.through_period,
                      amounts: r.opening.amounts,
                    }
                  : null,
              },
        ),
        openings:
          user.access === "admin"
            ? db
                .prepare(
                  "SELECT * FROM payroll_openings WHERE company_id=? ORDER BY employee_id",
                )
                .all(user.company_id)
            : [],
        events:
          user.access === "admin"
            ? db
                .prepare(
                  "SELECT * FROM payroll_opening_events WHERE company_id=? ORDER BY id DESC LIMIT 100",
                )
                .all(user.company_id)
            : [],
      },
      { headers },
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Ledger failed." },
      { status: 400 },
    );
  }
}
export async function POST(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    const body = await request.json();
    if (
      !Number.isSafeInteger(body.employee_id) ||
      !employeeInCompany(body.employee_id, user.company_id)
    )
      return Response.json({ error: "Employee not found." }, { status: 404 });
    if (!["opening", "clear_opening"].includes(body.action))
      throw Error("Invalid opening-balance action.");
    const parsed = body.action === "opening" ? parseOpening(body) : null;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (
        db
          .prepare(
            "SELECT i.id FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id WHERE r.company_id=? AND i.employee_id=? AND r.period BETWEEN '2026-01' AND '2026-12' LIMIT 1",
          )
          .get(user.company_id, body.employee_id)
      )
        throw Error(
          "Opening balances are locked after this employee's first payroll draft. Discard any drafts before editing; approved history is final.",
        );
      const old = openingFor(user.company_id, body.employee_id);
      if (parsed)
        db.prepare(
          "INSERT INTO payroll_openings(company_id,employee_id,year,through_period,data,reviewed_by,reference,created_by) VALUES(?,?,2026,?,?,?,?,?) ON CONFLICT(company_id,employee_id,year) DO UPDATE SET through_period=excluded.through_period,data=excluded.data,reviewed_by=excluded.reviewed_by,reference=excluded.reference,created_by=excluded.created_by,updated=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        ).run(
          user.company_id,
          body.employee_id,
          parsed.through_period,
          JSON.stringify(parsed.amounts),
          parsed.reviewed_by,
          parsed.reference,
          user.id,
        );
      else {
        if (!old) throw Error("Opening balance not found.");
        db.prepare(
          "DELETE FROM payroll_openings WHERE id=? AND company_id=?",
        ).run(old.id, user.company_id);
      }
      db.prepare(
        "INSERT INTO payroll_opening_events(company_id,employee_id,action,snapshot,actor_id) VALUES(?,?,?,?,?)",
      ).run(
        user.company_id,
        body.employee_id,
        body.action,
        JSON.stringify({ before: old ?? null, after: parsed }),
        user.id,
      );
      audit(
        user,
        parsed
          ? "Payroll opening balances recorded"
          : "Payroll opening balances cleared",
        String(body.employee_id),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Opening balance failed." },
      { status: 400 },
    );
  }
}
