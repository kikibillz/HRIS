import { requireUser, validPassword, verifyPassword, hashPassword, cookieName } from "@/lib/auth";
import { db } from "@/lib/db";
import { revokeCredentials } from "@/lib/account-links";

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  try {
    const body = await request.json();
    if (!validPassword(body.current_password) || !validPassword(body.password))
      return Response.json({ error: "Passwords must contain 12–128 characters." }, { status: 400 });
    const attempt = db.prepare("SELECT attempts,reset_at FROM password_attempts WHERE account_id=?")
      .get(user.id) as { attempts: number; reset_at: number } | undefined;
    if (attempt && attempt.reset_at > Date.now() && attempt.attempts >= 5)
      return Response.json({ error: "Too many attempts. Try again in 15 minutes or contact your administrator." }, { status: 429 });
    const account = db.prepare("SELECT password_hash FROM accounts WHERE id=?").get(user.id) as { password_hash: string };
    if (!verifyPassword(body.current_password, account.password_hash)) {
      const now = Date.now(), reset = now + 15 * 60 * 1000;
      db.prepare("INSERT INTO password_attempts(account_id,attempts,reset_at) VALUES (?,1,?) ON CONFLICT(account_id) DO UPDATE SET attempts=CASE WHEN reset_at>? THEN attempts+1 ELSE 1 END, reset_at=CASE WHEN reset_at>? THEN reset_at ELSE ? END")
        .run(user.id, reset, now, now, reset);
      return Response.json({ error: "Current password is incorrect." }, { status: 400 });
    }
    if (body.password === body.current_password)
      return Response.json({ error: "Choose a different new password." }, { status: 400 });
    const hash = hashPassword(body.password);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE accounts SET password_hash=? WHERE id=?").run(hash, user.id);
      revokeCredentials(user.id, user.employee_id, user.email);
      db.prepare("INSERT INTO security_events(employee_id,actor_id,action) VALUES (?,?,'Password changed')")
        .run(user.employee_id, user.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return Response.json({ ok: true }, { headers: { "Set-Cookie": `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`, "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Unable to change password." }, { status: 400 });
  }
}
