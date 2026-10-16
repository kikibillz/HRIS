import { parse } from "csv-parse/sync";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { department, audit } from "@/lib/tenant";
import { parseSalary, salaryFields } from "@/lib/payroll";
import { validDate } from "@/lib/leave-policy";
export async function POST(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    const b = await request.json();
    if (typeof b.csv !== "string" || b.csv.length > 2000000)
      throw Error("Upload a CSV under 2 MB.");
    const rows = parse(b.csv, {
      columns: (headers: string[]) => {
        if (new Set(headers).size !== headers.length)
          throw Error("CSV headers must be unique.");
        const allowed = new Set([
          "name",
          "email",
          "role",
          "department",
          "joined",
          ...salaryFields,
          "pension",
          "nhf",
          "excluded",
          "bank",
          "bank_account",
          "tax_id",
          "pension_id",
          "nhf_id",
        ]);
        const extra = headers.filter((h) => !allowed.has(h));
        if (extra.length)
          throw Error(
            `Unsupported CSV columns: ${extra.join(", ")}. Use the staff import template.`,
          );
        return headers;
      },
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
    }) as Record<string, string>[];
    if (!rows.length || rows.length > 1000)
      throw Error("Import between 1 and 1,000 staff per batch.");
    const emails = new Set<string>();
    const errors: { row: number; error: string }[] = [];
    const prepared = rows.map((r, i) => {
      try {
        const email = String(r.email || "")
          .trim()
          .toLowerCase();
        if (
          !r.name?.trim() ||
          r.name.length > 120 ||
          !/^\S+@\S+\.\S+$/.test(email) ||
          email.length > 254 ||
          !r.role?.trim() ||
          r.role.length > 120 ||
          !r.department?.trim() ||
          r.department.length > 100
        )
          throw Error("Name, valid email, role, and department are required.");
        if (
          emails.has(email) ||
          db.prepare("SELECT 1 FROM employees WHERE email=?").get(email)
        )
          throw Error(
            "Email is duplicated or unavailable. Existing employees are never overwritten.",
          );
        emails.add(email);
        const joined = r.joined || new Date().toISOString().slice(0, 10);
        if (!validDate(joined)) throw Error("Joined date must be YYYY-MM-DD.");
        return {
          ...r,
          name: r.name,
          department: r.department,
          role: r.role,
          email,
          joined,
          salary:
            r.basic !== undefined && r.basic !== "" ? parseSalary(r) : null,
        };
      } catch (e) {
        errors.push({
          row: i + 2,
          error: e instanceof Error ? e.message : "Invalid row",
        });
        return null;
      }
    });
    if (b.action !== "commit" || errors.length)
      return Response.json(
        { rows: prepared, errors, count: rows.length },
        { status: errors.length && b.action === "commit" ? 400 : 200 },
      );
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const r of prepared) {
        if (!r) continue;
        const dept = department(user.company_id, String(r.department));
        const id = Number(
          db
            .prepare(
              "INSERT INTO employees(name,email,role,department_id,joined) VALUES (?,?,?,?,?)",
            )
            .run(
              String(r.name).trim(),
              r.email,
              String(r.role).trim(),
              dept,
              r.joined,
            ).lastInsertRowid,
        );
        db.prepare("INSERT INTO company_employees VALUES (?,?)").run(
          id,
          user.company_id,
        );
        if (r.salary)
          db.prepare(
            "INSERT INTO compensation(employee_id,data) VALUES (?,?)",
          ).run(id, JSON.stringify(r.salary));
      }
      audit(user, "Staff imported", `${rows.length} employees`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return Response.json({ ok: true, count: rows.length });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Unable to import staff." },
      { status: 400 },
    );
  }
}
