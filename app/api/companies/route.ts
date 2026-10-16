import { db } from "@/lib/db";
import {
  sameOrigin,
  validPassword,
  hashPassword,
  sessionFor,
} from "@/lib/auth";
import { department } from "@/lib/tenant";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  try {
    const b = await request.json();
    if (
      typeof b.company !== "string" ||
      !b.company.trim() ||
      b.company.length > 120 ||
      typeof b.name !== "string" ||
      !b.name.trim() ||
      b.name.length > 120 ||
      typeof b.email !== "string" ||
      !/^\S+@\S+\.\S+$/.test(b.email) ||
      b.email.length > 254 ||
      !validPassword(b.password)
    )
      throw Error(
        "Enter your company, name, work email and a password of 12–128 characters.",
      );
    const hash = hashPassword(b.password);
    db.exec("BEGIN IMMEDIATE");
    let accountId: number;
    try {
      const company = Number(
        db
          .prepare("INSERT INTO companies(name) VALUES (?)")
          .run(b.company.trim()).lastInsertRowid,
      );
      const dept = department(company, "General");
      const employee = Number(
        db
          .prepare(
            "INSERT INTO employees(name,email,role,department_id,joined) VALUES (?,?,?,?,?)",
          )
          .run(
            b.name.trim(),
            b.email.toLowerCase().trim(),
            "Administrator",
            dept,
            new Date().toISOString().slice(0, 10),
          ).lastInsertRowid,
      );
      db.prepare("INSERT INTO company_employees VALUES (?,?)").run(
        employee,
        company,
      );
      accountId = Number(
        db
          .prepare(
            "INSERT INTO accounts(employee_id,email,password_hash,access) VALUES (?,?,?,'admin')",
          )
          .run(employee, b.email.toLowerCase().trim(), hash).lastInsertRowid,
      );
      db.prepare(
        "INSERT INTO audit_log(company_id,actor_id,action,target) VALUES (?,?,'Company created',?)",
      ).run(company, accountId, b.company.trim());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return Response.json(
      { ok: true },
      {
        status: 201,
        headers: { "Set-Cookie": sessionFor(accountId, request) },
      },
    );
  } catch {
    return Response.json(
      {
        error:
          "Unable to register. Check your details and use an email that is not already registered.",
      },
      { status: 400 },
    );
  }
}
