import { db } from "@/lib/db";
import { sameOrigin, hashPassword, validPassword, digest } from "@/lib/auth";
import { revokeCredentials } from "@/lib/account-links";

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json(
      { error: "Request origin is not allowed." },
      { status: 403 },
    );
  try {
    const body = await request.json();
    if (
      typeof body.token !== "string" ||
      !/^[a-f0-9]{64}$/.test(body.token) ||
      !validPassword(body.password)
    )
      return Response.json(
        { error: "Use a valid link and a password of 12–128 characters." },
        { status: 400 },
      );
    db.exec("BEGIN IMMEDIATE");
    try {
      const link = db
        .prepare(
          "SELECT * FROM account_links WHERE token_hash=? AND used_at IS NULL AND expires>?",
        )
        .get(digest(body.token), Date.now()) as
        | {
            employee_id: number;
            account_id: number | null;
            purpose: string;
            access: string;
          }
        | undefined;
      if (!link) {
        db.exec("ROLLBACK");
        return Response.json(
          {
            error:
              "This link is invalid, expired, or already used. Ask your administrator for a new link.",
          },
          { status: 400 },
        );
      }
      const employee = db
        .prepare("SELECT email,status FROM employees WHERE id=?")
        .get(link.employee_id) as { email: string; status: string };
      if (employee.status !== "Active") {
        db.exec("ROLLBACK");
        return Response.json(
          { error: "This account is inactive. Contact HR." },
          { status: 403 },
        );
      }
      const existing = db
        .prepare("SELECT id,email FROM accounts WHERE employee_id=?")
        .get(link.employee_id) as { id: number; email: string } | undefined;
      if (
        (link.purpose === "invite" && existing) ||
        (link.purpose === "reset" && existing?.id !== link.account_id)
      ) {
        db.exec("ROLLBACK");
        return Response.json(
          {
            error:
              "Account access changed. Ask your administrator for a new link.",
          },
          { status: 409 },
        );
      }
      const hash = hashPassword(body.password);
      const accountId =
        existing?.id ??
        Number(
          db
            .prepare(
              "INSERT INTO accounts(employee_id,email,password_hash,access) VALUES (?,?,?,?)",
            )
            .run(link.employee_id, employee.email, hash, link.access)
            .lastInsertRowid,
        );
      if (existing)
        db.prepare("UPDATE accounts SET password_hash=? WHERE id=?").run(
          hash,
          existing.id,
        );
      revokeCredentials(
        accountId,
        link.employee_id,
        existing?.email ?? employee.email,
      );
      db.prepare(
        "INSERT INTO security_events(employee_id,actor_id,action) VALUES (?,?,?)",
      ).run(
        link.employee_id,
        accountId,
        link.purpose === "invite" ? "Invitation accepted" : "Password reset",
      );
      db.exec("COMMIT");
      return Response.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch {
    return Response.json(
      {
        error: "Unable to set password. Ask your administrator for a new link.",
      },
      { status: 400 },
    );
  }
}
