import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { csv } from "@/lib/csv";
export async function GET(r: Request) {
  const u = await currentUser();
  if (!u) return Response.json({ error: "Please sign in." }, { status: 401 });
  if (u.access !== "admin")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  const url = new URL(r.url),
    type = url.searchParams.get("type") || "analytics";
  if (type === "audit") {
    const rows = db
      .prepare(
        "SELECT a.*,e.name AS actor FROM audit_log a JOIN accounts ac ON ac.id=a.actor_id JOIN employees e ON e.id=ac.employee_id WHERE a.company_id=? ORDER BY a.id DESC LIMIT 1000",
      )
      .all(u.company_id);
    const security = db
      .prepare(
        "SELECT s.id,s.action,s.created,e.name FROM security_events s JOIN employees e ON e.id=s.employee_id JOIN company_employees ce ON ce.employee_id=e.id WHERE ce.company_id=? ORDER BY s.id DESC LIMIT 300",
      )
      .all(u.company_id);
    const leave = db
      .prepare(
        "SELECT v.id,v.action,v.note,v.created,e.name FROM leave_events v JOIN leaves l ON l.id=v.leave_id JOIN employees e ON e.id=l.employee_id JOIN company_employees ce ON ce.employee_id=e.id WHERE ce.company_id=? ORDER BY v.id DESC LIMIT 300",
      )
      .all(u.company_id);
    return Response.json(
      { rows, security, leave },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (type === "payroll") {
    const rawRun = url.searchParams.get("run_id"),
      runId = rawRun ? Number(rawRun) : null;
    if (rawRun && (!Number.isSafeInteger(runId) || runId! < 1))
      return Response.json({ error: "Invalid payroll run." }, { status: 400 });
    const rows = db
      .prepare(
        "SELECT r.period,r.status,COALESCE(json_extract(i.details,'$.name'),e.name) AS name,e.email,i.details FROM payroll_items i JOIN payroll_runs r ON r.id=i.run_id JOIN employees e ON e.id=i.employee_id WHERE r.company_id=? AND r.status<>'Draft' AND (? IS NULL OR r.id=?) ORDER BY r.period,e.name",
      )
      .all(u.company_id, runId, runId) as {
      period: string;
      status: string;
      name: string;
      email: string;
      details: string;
    }[];
    const data = rows.map((r) => {
      const d = JSON.parse(r.details);
      return {
        period: r.period,
        status: r.status,
        name: r.name,
        email: r.email,
        gross_kobo: d.gross,
        paye_kobo: d.paye,
        pension_kobo: d.pension,
        employer_pension_kobo: d.employer_pension,
        nhf_kobo: d.nhf,
        nhis_kobo: d.nhis,
        other_deductions_kobo: d.other_deductions,
        net_kobo: d.net,
        employer_ecs_kobo: d.employer_ecs,
        employer_itf_kobo: d.employer_itf,
        bank: d.bank,
        bank_account: d.bank_account,
        tax_id: d.tax_id,
        pension_id: d.pension_id,
        nhf_id: d.nhf_id,
      };
    });
    return new Response(csv(data), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=payroll-schedule.csv",
        "Cache-Control": "no-store",
      },
    });
  }
  const headcount = db
    .prepare(
      "SELECT cd.display_name AS department,COUNT(*) AS employees FROM employees e JOIN company_employees ce ON ce.employee_id=e.id JOIN company_departments cd ON cd.department_id=e.department_id WHERE ce.company_id=? AND e.status='Active' GROUP BY cd.display_name",
    )
    .all(u.company_id);
  const funnel = db
    .prepare(
      "SELECT status,COUNT(*) AS count FROM hr_records WHERE company_id=? AND kind='applicants' GROUP BY status",
    )
    .all(u.company_id);
  const progress = db
    .prepare(
      "SELECT kind,status,COUNT(*) AS count,CASE WHEN kind='goals' THEN AVG(progress) ELSE NULL END AS average_goal_progress FROM hr_records WHERE company_id=? AND kind IN ('goals','tasks','enrollments','reviews') GROUP BY kind,status",
    )
    .all(u.company_id);
  const payroll = (
    db
      .prepare(
        "SELECT r.id,r.period,r.status,i.details FROM payroll_runs r JOIN payroll_items i ON i.run_id=r.id WHERE r.company_id=? ORDER BY r.period",
      )
      .all(u.company_id) as {
      id: number;
      period: string;
      status: string;
      details: string;
    }[]
  ).reduce(
    (
      a: Record<
        string,
        {
          period: string;
          status: string;
          gross: number;
          net: number;
          tax: number;
          employer_cost: number;
        }
      >,
      r,
    ) => {
      const d = JSON.parse(r.details);
      const k = String(r.id);
      const x = a[k] ?? {
        period: r.period,
        status: r.status,
        gross: 0,
        net: 0,
        tax: 0,
        employer_cost: 0,
      };
      x.gross += d.gross;
      x.net += d.net;
      x.tax += d.paye;
      x.employer_cost += d.employer_cost;
      a[k] = x;
      return a;
    },
    {},
  );
  const attendance = db
    .prepare(
      "SELECT substr(a.clock_in,1,10) AS day,COUNT(*) AS shifts,SUM(CASE WHEN a.clock_out IS NOT NULL THEN (julianday(a.clock_out)-julianday(a.clock_in))*24 ELSE 0 END) AS hours FROM attendance a JOIN company_employees ce ON ce.employee_id=a.employee_id WHERE ce.company_id=? GROUP BY day ORDER BY day DESC LIMIT 31",
    )
    .all(u.company_id);
  const company = db
    .prepare("SELECT created FROM companies WHERE id=?")
    .get(u.company_id) as { created: string };
  const first = db
    .prepare(
      "SELECT created FROM audit_log WHERE company_id=? AND action='Payroll approved' ORDER BY id LIMIT 1",
    )
    .get(u.company_id) as { created: string } | undefined;
  const counts = db
    .prepare(
      "SELECT (SELECT COUNT(*) FROM company_employees WHERE company_id=?) AS staff,(SELECT COUNT(*) FROM compensation c JOIN company_employees ce ON ce.employee_id=c.employee_id WHERE ce.company_id=?) AS compensation,(SELECT COUNT(*) FROM payroll_runs WHERE company_id=? AND status IN ('Approved','Paid')) AS approved",
    )
    .get(u.company_id, u.company_id, u.company_id);
  const hires = db
    .prepare(
      "SELECT substr(e.joined,1,7) AS joined_month,COUNT(*) AS staff,SUM(CASE WHEN e.status='Active' THEN 1 ELSE 0 END) AS currently_active FROM employees e JOIN company_employees ce ON ce.employee_id=e.id WHERE ce.company_id=? GROUP BY joined_month ORDER BY joined_month",
    )
    .all(u.company_id);
  const ratings = db
    .prepare(
      "SELECT cd.display_name AS department,COUNT(*) AS published_reviews,AVG(CAST(json_extract(r.data,'$.rating') AS REAL)) AS mean_rating FROM hr_records r JOIN employees e ON e.id=r.employee_id JOIN company_departments cd ON cd.department_id=e.department_id WHERE r.company_id=? AND r.kind='reviews' AND r.status='Published' GROUP BY cd.display_name",
    )
    .all(u.company_id);
  const hiring_time = db
    .prepare(
      "SELECT COUNT(*) AS hired_candidates,AVG(julianday(ev.hired)-julianday(r.created)) AS average_days_to_hire FROM hr_records r JOIN (SELECT record_id,MIN(created) AS hired FROM hr_record_events WHERE status='Hired' GROUP BY record_id) ev ON ev.record_id=r.id WHERE r.company_id=? AND r.kind='applicants'",
    )
    .get(u.company_id);
  return Response.json(
    {
      hires,
      ratings,
      hiring_time,
      headcount,
      funnel,
      progress,
      payroll: Object.values(payroll),
      attendance,
      counts,
      first_payroll_hours: first
        ? (Date.parse(first.created) - Date.parse(company.created)) / 3600000
        : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
