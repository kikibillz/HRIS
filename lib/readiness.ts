import { DatabaseSync } from "node:sqlite";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";
export function ready(dir: string) {
  let db: DatabaseSync | undefined;
  try {
    accessSync(dir, constants.W_OK);
    const path = join(dir, "hris.sqlite");
    accessSync(path, constants.R_OK | constants.W_OK);
    db = new DatabaseSync(path, { readOnly: true });
    db.exec("PRAGMA busy_timeout=1000");
    for (const table of [
      "accounts",
      "companies",
      "employees",
      "company_recovery_identity",
    ])
      db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}
