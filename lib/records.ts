import { assertHiringApproval } from "./recruiting";
import { db } from "./db";
import type { User } from "./auth";
import { canManageEmployee, employeeInCompany, audit, notify } from "./tenant";
import { modules, referenceKinds } from "./modules";
import { validDate } from "./leave-policy";
export type HRRecord = {
  id: number;
  company_id: number;
  kind: string;
  employee_id: number | null;
  reviewer_id: number | null;
  title: string;
  body: string;
  status: string;
  progress: number;
  due: string;
  reference_id: number | null;
  data: string;
  created_by: number;
  created: string;
};
export function canReadRecord(user: User, r: HRRecord) {
  if (r.company_id !== user.company_id) return false;
  if (user.access === "admin") return true;
  if (["policies", "courses"].includes(r.kind)) return r.status === "Published";
  if (modules[r.kind]?.admin) return false;
  if (r.kind === "letters") return r.employee_id === user.employee_id;
  if (r.kind === "reviews")
    return (
      r.reviewer_id === user.employee_id ||
      (r.employee_id === user.employee_id && r.status === "Published")
    );
  if (r.kind === "feedback")
    return (
      r.reviewer_id === user.employee_id ||
      (r.employee_id === user.employee_id && r.status === "Submitted")
    );
  return r.employee_id !== null && canManageEmployee(user, r.employee_id);
}
export function listRecords(user: User, kind: string) {
  if (!Object.hasOwn(modules, kind)) throw Error("Unknown module.");
  return (
    db
      .prepare(
        "SELECT * FROM hr_records WHERE company_id=? AND kind=? ORDER BY id DESC",
      )
      .all(user.company_id, kind) as HRRecord[]
  )
    .filter((r) => canReadRecord(user, r))
    .map((r) => {
      const data = JSON.parse(r.data);
      if (user.access !== "admin" && r.kind === "courses")
        delete data.quiz_answer;
      return { ...r, data };
    });
}
export function writeRecord(
  user: User,
  kind: string,
  b: Record<string, unknown>,
  id?: number,
) {
  const m = modules[kind];
  if (!Object.hasOwn(modules, kind)) throw Error("Unknown module.");
  const old = id
    ? (db
        .prepare(
          "SELECT * FROM hr_records WHERE id=? AND company_id=? AND kind=?",
        )
        .get(id, user.company_id, kind) as HRRecord | undefined)
    : undefined;
  if (id && !old) throw Error("Record not found.");
  if (kind === "tasks" && !old && b.reference_id)
    throw Error("Checklist assignment references are managed by the server.");
  if (m.admin && user.access !== "admin")
    throw Error("Administrator access required.");
  if (
    ["policies", "courses", "letters"].includes(kind) &&
    user.access !== "admin"
  )
    throw Error("Administrator access required.");
  const employeeId =
    old?.employee_id ?? (b.employee_id ? Number(b.employee_id) : null);
  const reviewerId =
    old?.reviewer_id ?? (b.reviewer_id ? Number(b.reviewer_id) : null);
  if (employeeId !== null && !employeeInCompany(employeeId, user.company_id))
    throw Error("Employee not found.");
  if (reviewerId !== null && !employeeInCompany(reviewerId, user.company_id))
    throw Error("Reviewer not found.");
  if (
    employeeId !== null &&
    !canManageEmployee(user, employeeId) &&
    !(old?.reviewer_id === user.employee_id)
  )
    throw Error("Employee access denied.");
  if (["reviews", "feedback"].includes(kind)) {
    if (!reviewerId || !employeeId || reviewerId === employeeId)
      throw Error("Choose a different employee as reviewer.");
    if (!old && kind === "reviews" && user.access === "employee")
      throw Error(
        "Only HR or the assigned manager can start a performance review.",
      );
    if (old && user.access !== "admin" && old.reviewer_id !== user.employee_id)
      throw Error("Only the assigned reviewer or HR can edit a response.");
    if (
      old?.status === "Published" ||
      (old?.status === "Submitted" && kind === "feedback")
    )
      throw Error("This response is already final.");
  }
  if (old?.kind === "enrollments" && old.status === "Completed")
    throw Error("Completed learning records cannot be edited.");
  const data: Record<string, string | number> = {};
  const merged = { ...(old ? JSON.parse(old.data) : {}), ...b };
  for (const field of m.fields) {
    const value = merged[field.key];
    if (
      field.required &&
      (value === undefined || value === null || String(value).trim() === "")
    )
      throw Error(`${field.label} is required.`);
    if (field.type === "number") {
      if (value !== undefined && value !== "") {
        const n = Number(value);
        if (
          !Number.isFinite(n) ||
          n < (field.min ?? 0) ||
          n > (field.max ?? 1000000)
        )
          throw Error(`Invalid ${field.label}.`);
        data[field.key] = n;
      }
    } else {
      const text = String(value ?? "").trim();
      if (text.length > (field.type === "textarea" ? 20000 : 500))
        throw Error(`${field.label} is too long.`);
      if (field.type === "date" && text && !validDate(text))
        throw Error("Enter a valid date.");
      if (field.type === "email" && text && !/^\S+@\S+\.\S+$/.test(text))
        throw Error("Enter a valid email.");
      data[field.key] = text;
    }
  }
  if (old) {
    data.employee_id = employeeId ?? "";
    data.reviewer_id = reviewerId ?? "";
    data.reference_id = old.reference_id ?? "";
  }
  if (data.url && !/^https:\/\//.test(String(data.url)))
    throw Error("Learning links must use HTTPS.");
  if (
    kind === "courses" &&
    Boolean(data.quiz_question) !== Boolean(data.quiz_answer)
  )
    throw Error(
      "Provide both the knowledge-check question and accepted answer.",
    );
  let status = String(b.status ?? old?.status ?? m.statuses[0]);
  if (!m.statuses.includes(status)) throw Error("Invalid status.");
  if (kind === "reviews" && status === "Published" && user.access !== "admin")
    throw Error("HR publishes performance reviews.");
  if (
    ["reviews", "feedback"].includes(kind) &&
    ["Submitted", "Published"].includes(status) &&
    (!data.body || !data.rating)
  )
    throw Error("Provide a rating and response before submitting.");
  const referenceId =
    old?.reference_id ?? (b.reference_id ? Number(b.reference_id) : null);
  const ref = referenceId
    ? (db
        .prepare(
          "SELECT * FROM hr_records WHERE id=? AND company_id=? AND kind=?",
        )
        .get(referenceId, user.company_id, referenceKinds[kind] ?? "") as
        HRRecord | undefined)
    : undefined;
  if (referenceKinds[kind] && !ref)
    throw Error("Choose a valid record from this company.");
  if (kind === "applicants" && !old && ref?.status !== "Open")
    throw Error("This vacancy is not open.");
  if (kind === "enrollments") {
    if (!old && ref?.status !== "Published")
      throw Error("This course is unavailable.");
    if (status === "Completed") {
      const expected = JSON.parse(ref!.data).quiz_answer;
      if (
        expected &&
        String(data.quiz_answer).trim().toLowerCase() !==
          String(expected).trim().toLowerCase()
      )
        throw Error("The knowledge-check answer is incorrect.");
    }
    delete data.quiz_answer;
  }
  if (
    ((kind === "goals" || kind === "enrollments") && status === "Completed") ||
    (kind === "tasks" && status === "Done")
  )
    data.progress = 100;
  let body = String(data.body ?? old?.body ?? "");
  if (kind === "letters") {
    if (old) throw Error("Issued letters cannot be edited.");
    const e = db
      .prepare("SELECT name,role,joined FROM employees WHERE id=?")
      .get(employeeId!) as { name: string; role: string; joined: string };
    const company = db
      .prepare("SELECT name FROM companies WHERE id=?")
      .get(user.company_id) as { name: string };
    const values: Record<string, string> = {
      employee_name: e.name,
      role: e.role,
      start_date: e.joined,
      company_name: company.name,
    };
    body = ref!.body.replace(
      /\{\{(employee_name|role|start_date|company_name)\}\}/g,
      (_, key: string) => values[key],
    );
    status = "Issued";
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    if (
      kind === "applicants" &&
      ["Offer", "Hired"].includes(status) &&
      old?.status !== status
    ) {
      if (!old)
        throw Error(
          "Create the candidate in an earlier stage, then request hiring approval.",
        );
      // Validate the exact candidate/job evidence being written, not just the old row.
      if (
        String(data.title) !== old.title ||
        body !== old.body ||
        String(data.due ?? old.due) !== old.due ||
        String(data.email ?? "") !== String(JSON.parse(old.data).email ?? "")
      )
        throw Error(
          "Save candidate changes before requesting hiring approval.",
        );
      const latest = db
        .prepare(
          "SELECT title,body,data,due,status FROM hr_records WHERE id=? AND company_id=?",
        )
        .get(old.id, user.company_id) as HRRecord;
      if (
        ["title", "body", "data", "due", "status"].some(
          (key) => latest[key as keyof HRRecord] !== old[key as keyof HRRecord],
        )
      )
        throw Error(
          "The candidate changed. Refresh and review the latest record.",
        );
      assertHiringApproval(user.company_id, old.id);
    }
    let recordId = id;
    if (old) {
      db.prepare(
        "UPDATE hr_records SET title=?,body=?,status=?,progress=?,due=?,data=? WHERE id=?",
      ).run(
        String(data.title),
        body,
        status,
        Number(data.progress ?? old.progress),
        String(data.due ?? old.due),
        JSON.stringify(data),
        id!,
      );
    } else {
      recordId = Number(
        db
          .prepare(
            "INSERT INTO hr_records(company_id,kind,employee_id,reviewer_id,title,body,status,progress,due,reference_id,data,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            user.company_id,
            kind,
            employeeId,
            reviewerId,
            String(data.title),
            body,
            status,
            Number(data.progress ?? 0),
            String(data.due ?? ""),
            referenceId,
            JSON.stringify(data),
            user.id,
          ).lastInsertRowid,
      );
    }
    db.prepare(
      "INSERT INTO hr_record_events(record_id,status,actor_id) VALUES (?,?,?)",
    ).run(recordId!, status, user.id);
    audit(user, `${kind} ${old ? "updated" : "created"}`, String(recordId));
    if (employeeId && employeeId !== user.employee_id)
      notify(employeeId, m.title, `${String(data.title)} · ${status}`);
    if (reviewerId && !old)
      notify(reviewerId, "Review requested", String(data.title));
    db.exec("COMMIT");
    return recordId;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
