import { randomBytes } from "node:crypto";
import { db } from "./db";
import { digest } from "./auth";

export function invalidateLinks(employeeId: number) {
  db.prepare("UPDATE account_links SET used_at=? WHERE employee_id=? AND used_at IS NULL")
    .run(Date.now(), employeeId);
}

// Caller owns the transaction. Raw tokens are returned once and never persisted.
export function issueAccountLink(employeeId: number, actorId: number, access: "employee" | "manager" = "employee") {
  const account = db.prepare("SELECT id,access FROM accounts WHERE employee_id=?")
    .get(employeeId) as { id: number; access: string } | undefined;
  const purpose = account ? "reset" : "invite";
  const expires = Date.now() + (account ? 60 * 60 * 1000 : 48 * 60 * 60 * 1000);
  const token = randomBytes(32).toString("hex");
  invalidateLinks(employeeId);
  db.prepare("INSERT INTO account_links(token_hash,employee_id,account_id,purpose,access,expires,created_by) VALUES (?,?,?,?,?,?,?)")
    .run(digest(token), employeeId, account?.id ?? null, purpose, account?.access ?? access, expires, actorId);
  db.prepare("INSERT INTO security_events(employee_id,actor_id,action) VALUES (?,?,?)")
    .run(employeeId, actorId, purpose === "invite" ? "Invitation issued" : "Recovery link issued");
  return { path: `/activate#token=${token}`, purpose, expires };
}

export function revokeCredentials(accountId: number, employeeId: number, email: string) {
  db.prepare("DELETE FROM sessions WHERE account_id=?").run(accountId);
  db.prepare("DELETE FROM login_attempts WHERE email=?").run(email);
  db.prepare("DELETE FROM password_attempts WHERE account_id=?").run(accountId);
  invalidateLinks(employeeId);
}
