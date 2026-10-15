import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { allowances, validDate, workdays, balances } from "@/lib/leave";
export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  try {
    const b = await request.json();
    const employeeId =
      user.access === "admin" ? Number(b.employee_id) : user.employee_id;
    if (
      user.access !== "admin" &&
      b.employee_id &&
      Number(b.employee_id) !== user.employee_id
    )
      return Response.json(
        { error: "You may only request leave for yourself." },
        { status: 403 },
      );
    if (
      !Object.hasOwn(allowances, b.type) ||
      !validDate(b.start) ||
      !validDate(b.end) ||
      b.end < b.start ||
      b.start.slice(0, 4) !== b.end.slice(0, 4) ||
      b.start < new Date().toISOString().slice(0, 10) ||
      Number(b.start.slice(0, 4)) > new Date().getUTCFullYear() + 1
    )
      return Response.json(
        {
          error:
            "Choose valid future dates within a single calendar year, this year or next.",
        },
        { status: 400 },
      );
    const days = workdays(b.start, b.end);
    if (!days)
      return Response.json(
        { error: "Select at least one working day (Monday–Friday)." },
        { status: 400 },
      );
    if (
      typeof b.reason !== "string" ||
      !b.reason.trim() ||
      b.reason.length > 1000
    )
      return Response.json(
        { error: "Add a reason of up to 1,000 characters." },
        { status: 400 },
      );
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!db.prepare("SELECT id FROM employees WHERE id=?").get(employeeId)) {
        db.exec("ROLLBACK");
        return Response.json(
          { error: "Employee does not exist." },
          { status: 400 },
        );
      }
      if (
        db
          .prepare(
            "SELECT id FROM leaves WHERE employee_id=? AND status IN ('Pending','Approved') AND start<=? AND end>=?",
          )
          .get(employeeId, b.end, b.start)
      ) {
        db.exec("ROLLBACK");
        return Response.json(
          {
            error:
              "These dates overlap an existing pending or approved request.",
          },
          { status: 409 },
        );
      }
      const balance = balances(employeeId, Number(b.start.slice(0, 4))).find(
        (x) => x.type === b.type,
      )!;
      if (days > balance.available) {
        db.exec("ROLLBACK");
        return Response.json(
          {
            error: `Only ${balance.available} days are available for ${b.type.toLowerCase()}. Pending requests reserve days.`,
          },
          { status: 409 },
        );
      }
      const result = db
        .prepare(
          "INSERT INTO leaves(employee_id,type,start,end) VALUES (?,?,?,?)",
        )
        .run(employeeId, b.type, b.start, b.end);
      db.prepare("INSERT INTO leave_details(leave_id,reason) VALUES (?,?)").run(
        result.lastInsertRowid,
        b.reason.trim(),
      );
      db.prepare(
        "INSERT INTO leave_events(leave_id,actor_id,action,note) VALUES (?,?,'Submitted','')",
      ).run(result.lastInsertRowid, user.id);
      db.exec("COMMIT");
      return Response.json({ ok: true }, { status: 201 });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch {
    return Response.json(
      { error: "Unable to submit leave request." },
      { status: 400 },
    );
  }
}
export async function PATCH(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  try {
    const b = await request.json();
    if (!["Approved", "Declined", "Cancelled"].includes(b.status))
      return Response.json({ error: "Invalid decision." }, { status: 400 });
    const leave = db
      .prepare("SELECT employee_id,status FROM leaves WHERE id=?")
      .get(Number(b.id)) as { employee_id: number; status: string } | undefined;
    if (!leave)
      return Response.json({ error: "Request not found." }, { status: 404 });
    if (
      b.status === "Cancelled"
        ? leave.employee_id !== user.employee_id
        : user.access === "employee" || leave.employee_id === user.employee_id
    )
      return Response.json(
        {
          error:
            b.status === "Cancelled"
              ? "Only the requester may cancel."
              : "Managers may review other employees’ requests, never their own.",
        },
        { status: 403 },
      );
    if (
      typeof b.note !== "string" ||
      b.note.length > 1000 ||
      (b.status === "Declined" && !b.note.trim())
    )
      return Response.json(
        { error: "Add a reason when declining (up to 1,000 characters)." },
        { status: 400 },
      );
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db
        .prepare("UPDATE leaves SET status=? WHERE id=? AND status='Pending'")
        .run(b.status, Number(b.id));
      if (!result.changes) {
        db.exec("ROLLBACK");
        return Response.json(
          { error: "Only pending requests can be changed." },
          { status: 409 },
        );
      }
      db.prepare(
        "INSERT INTO leave_events(leave_id,actor_id,action,note) VALUES (?,?,?,?)",
      ).run(Number(b.id), user.id, b.status, b.note.trim());
      db.exec("COMMIT");
      return Response.json({ ok: true });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch {
    return Response.json(
      { error: "Unable to update request." },
      { status: 400 },
    );
  }
}
