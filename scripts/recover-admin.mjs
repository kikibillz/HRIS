#!/usr/bin/env node
// Requires trusted operator access to the existing workspace database.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, createHash } from "node:crypto";

const [email, origin] = process.argv.slice(2);
try {
  if (!email || !origin) throw Error('Usage: node scripts/recover-admin.mjs admin@example.com https://your-workspace-origin');
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.origin !== origin)
    throw Error('Supply the exact workspace origin, without a path or trailing slash.');
  const path = join(process.env.HRIS_DATA_DIR || join(process.cwd(), 'data'), 'hris.sqlite');
  if (!existsSync(path)) throw Error('Existing database not found. Run from the HRIS repository, or set HRIS_DATA_DIR. No database was created.');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;');
  const account = db.prepare("SELECT id,employee_id FROM accounts WHERE email=? AND access='admin'")
    .get(email.trim().toLowerCase());
  if (!account) throw Error('No administrator account matches that email. No account was changed.');
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE account_links SET used_at=? WHERE employee_id=? AND used_at IS NULL').run(now, account.employee_id);
    db.prepare("INSERT INTO account_links(token_hash,employee_id,account_id,purpose,access,expires,created_by) VALUES (?,?,?,'reset','admin',?,?)")
      .run(createHash('sha256').update(token).digest('hex'), account.employee_id, account.id, now+3600000, account.id);
    db.prepare("INSERT INTO security_events(employee_id,actor_id,action) VALUES (?,NULL,'Operator recovery link issued')").run(account.employee_id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  db.close();
  console.log('One-use administrator recovery link (expires in one hour). Share privately with the verified account owner:');
  console.log(`${origin}/activate#token=${token}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Recovery failed.');
  process.exitCode = 1;
}
