import { cookies } from "next/headers";
import { db } from "@/lib/db";
import {
  cookieName,
  digest,
  hashPassword,
  validPassword,
  verifyPassword,
  setupAvailable,
  sameOrigin,
  sessionFor,
} from "@/lib/auth";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  try {
    const b = await request.json();
    const email =
      typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    if (
      !/^\S+@\S+\.\S+$/.test(email) ||
      email.length > 254 ||
      !validPassword(b.password)
    )
      return Response.json(
        { error: "Use a valid email and a password of 12–128 characters." },
        { status: 400 },
      );
    if (b.action === "setup") {
      if (!setupAvailable())
        return Response.json(
          { error: "Initial setup is not available." },
          { status: 403 },
        );
      if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 120)
        return Response.json({ error: "Enter your name." }, { status: 400 });
      const hash = hashPassword(b.password);
      db.exec("BEGIN IMMEDIATE");
      try {
        if (!setupAvailable()) {
          db.exec("ROLLBACK");
          return Response.json(
            { error: "Setup is already complete." },
            { status: 409 },
          );
        }
        let employee = db
          .prepare("SELECT id FROM employees WHERE email=?")
          .get(email) as { id: number } | undefined;
        if (!employee) {
          const department = db
            .prepare("SELECT id FROM departments ORDER BY id LIMIT 1")
            .get() as { id: number };
          const result = db
            .prepare(
              "INSERT INTO employees(name,email,role,department_id,joined) VALUES (?,?,?,?,?)",
            )
            .run(
              b.name.trim(),
              email,
              "HR Administrator",
              department.id,
              new Date().toISOString().slice(0, 10),
            );
          employee = { id: Number(result.lastInsertRowid) };
        }
        db.prepare(
          "INSERT OR IGNORE INTO company_employees(employee_id,company_id) VALUES (?,1)",
        ).run(employee.id);
        const account = db
          .prepare(
            "INSERT INTO accounts(employee_id,email,password_hash,access) VALUES (?,?,?,'admin')",
          )
          .run(employee.id, email, hash);
        db.exec("COMMIT");
        return Response.json(
          { ok: true },
          {
            status: 201,
            headers: {
              "Set-Cookie": sessionFor(
                Number(account.lastInsertRowid),
                request,
              ),
            },
          },
        );
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
    const attempt = db
      .prepare("SELECT * FROM login_attempts WHERE email=?")
      .get(email) as { attempts: number; reset_at: number } | undefined;
    if (attempt && attempt.reset_at > Date.now() && attempt.attempts >= 10)
      return Response.json(
        { error: "Too many attempts. Try again in 15 minutes." },
        { status: 429 },
      );
    const account = db
      .prepare(
        "SELECT a.id,a.password_hash FROM accounts a JOIN employees e ON e.id=a.employee_id WHERE a.email=? AND e.status='Active'",
      )
      .get(email) as { id: number; password_hash: string } | undefined;
    const valid = verifyPassword(
      b.password,
      account?.password_hash || "not-a-real-salt:" + "0".repeat(128),
    );
    if (!account || !valid) {
      const reset = Date.now() + 15 * 60 * 1000;
      db.prepare(
        "INSERT INTO login_attempts(email,attempts,reset_at) VALUES (?,1,?) ON CONFLICT(email) DO UPDATE SET attempts=CASE WHEN reset_at>? THEN attempts+1 ELSE 1 END, reset_at=CASE WHEN reset_at>? THEN reset_at ELSE ? END",
      ).run(email, reset, Date.now(), Date.now(), reset);
      return Response.json(
        { error: "Email or password is incorrect." },
        { status: 401 },
      );
    }
    db.prepare("DELETE FROM login_attempts WHERE email=?").run(email);
    return Response.json(
      { ok: true },
      { headers: { "Set-Cookie": sessionFor(account.id, request) } },
    );
  } catch {
    return Response.json(
      { error: "Unable to sign in. Please try again." },
      { status: 400 },
    );
  }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request))
    return Response.json(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  const token = (await cookies()).get(cookieName)?.value;
  if (token)
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(token));
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      },
    },
  );
}
