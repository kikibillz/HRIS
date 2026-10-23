import { db } from "./db";
import type { User } from "./auth";
import { audit } from "./tenant";
export type InboxFilters = {
  status: string;
  ownership: string;
  overdue_only: boolean;
  needs_hr_owner: boolean;
  search: string;
};
function filters(value: unknown): InboxFilters {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid inbox filters.");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(",") !==
      "needs_hr_owner,overdue_only,ownership,search,status" ||
    typeof v.status !== "string" ||
    !["Open", "Resolved", "All"].includes(v.status) ||
    typeof v.ownership !== "string" ||
    !["all", "mine", "unassigned"].includes(v.ownership) ||
    typeof v.overdue_only !== "boolean" ||
    typeof v.needs_hr_owner !== "boolean" ||
    typeof v.search !== "string" ||
    v.search.length > 200
  )
    throw new Error("Invalid inbox filters.");
  return {
    status: String(v.status),
    ownership: String(v.ownership),
    overdue_only: v.overdue_only,
    needs_hr_owner: v.needs_hr_owner,
    search: v.search,
  };
}
export function followupViews(user: User, archived = false) {
  if (user.access !== "admin")
    throw new Error("Administrator access required.");
  return db
    .prepare(
      "SELECT id,name,filters_json,version,pinned FROM review_followup_views WHERE company_id=? AND account_id=? AND archived=? ORDER BY pinned DESC,name_key,id",
    )
    .all(user.company_id, user.id, Number(archived))
    .map(({ filters_json, ...row }) => ({
      ...row,
      filters: JSON.parse(String(filters_json)),
    }));
}
export function saveFollowupView(user: User, b: Record<string, unknown>) {
  if (user.access !== "admin")
    throw new Error("Administrator access required.");
  if (
    typeof b.action !== "string" ||
    !["save", "archive", "pin", "restore"].includes(b.action)
  )
    throw new Error("Invalid saved view action.");
  const editing = b.id !== undefined;
  if (
    (editing &&
      (!Number.isSafeInteger(b.id) ||
        Number(b.id) < 1 ||
        !Number.isSafeInteger(b.expected_version) ||
        Number(b.expected_version) < 1)) ||
    (!editing && b.action !== "save")
  )
    throw new Error("Invalid saved view ID or version.");
  if (b.action === "pin" && typeof b.pinned !== "boolean")
    throw new Error("Choose whether to pin this view.");
  const name =
    (b.action === "save" || b.action === "restore") &&
    typeof b.name === "string"
      ? b.name.trim()
      : "";
  if (
    (b.action === "save" || b.action === "restore") &&
    (!name || name.length > 100)
  )
    throw new Error("Enter a view name of up to 100 characters.");
  const settings =
    b.action === "save" ? JSON.stringify(filters(b.filters)) : "";
  db.exec("BEGIN IMMEDIATE");
  try {
    const old = editing
      ? db
          .prepare(
            "SELECT * FROM review_followup_views WHERE id=? AND company_id=? AND account_id=? AND archived=?",
          )
          .get(
            Number(b.id),
            user.company_id,
            user.id,
            b.action === "restore" ? 1 : 0,
          )
      : undefined;
    if (editing && !old) throw new Error("Saved view not found.");
    if (old && old.version !== b.expected_version)
      throw new Error("This view changed. Refresh saved views before editing.");
    if (b.action === "restore") {
      if (
        db
          .prepare(
            "SELECT id FROM review_followup_views WHERE company_id=? AND account_id=? AND name_key=? AND archived=0",
          )
          .get(user.company_id, user.id, name.toLowerCase())
      )
        throw new Error(
          "You already have a view with this name. Choose another restore name.",
        );
      db.prepare(
        "UPDATE review_followup_views SET archived=0,pinned=0,name=?,name_key=?,version=version+1 WHERE id=?",
      ).run(name, name.toLowerCase(), Number(old!.id));
      audit(user, "Restored private inbox view", String(old!.id));
      db.exec("COMMIT");
      return { id: old!.id, unchanged: false };
    }
    if (b.action === "pin") {
      if (Number(old!.pinned) === Number(b.pinned)) {
        db.exec("COMMIT");
        return { id: old!.id, unchanged: true };
      }
      db.prepare(
        "UPDATE review_followup_views SET pinned=?,version=version+1 WHERE id=?",
      ).run(Number(b.pinned), Number(old!.id));
      audit(
        user,
        b.pinned ? "Pinned private inbox view" : "Unpinned private inbox view",
        String(old!.id),
      );
      db.exec("COMMIT");
      return { id: old!.id, unchanged: false };
    }
    if (
      old &&
      b.action === "save" &&
      old.name === name &&
      old.filters_json === settings
    ) {
      db.exec("COMMIT");
      return { id: old.id, unchanged: true };
    }
    let id = old?.id;
    if (b.action === "archive")
      db.prepare(
        "UPDATE review_followup_views SET archived=1,pinned=0,version=version+1 WHERE id=?",
      ).run(Number(id));
    else {
      if (
        db
          .prepare(
            "SELECT id FROM review_followup_views WHERE company_id=? AND account_id=? AND name_key=? AND archived=0 AND id<>?",
          )
          .get(user.company_id, user.id, name.toLowerCase(), Number(id || 0))
      )
        throw new Error("You already have a view with this name.");
      if (old)
        db.prepare(
          "UPDATE review_followup_views SET name=?,name_key=?,filters_json=?,version=version+1 WHERE id=?",
        ).run(name, name.toLowerCase(), settings, Number(id));
      else
        id = Number(
          db
            .prepare(
              "INSERT INTO review_followup_views(company_id,account_id,name,name_key,filters_json) VALUES(?,?,?,?,?)",
            )
            .run(user.company_id, user.id, name, name.toLowerCase(), settings)
            .lastInsertRowid,
        );
    }
    audit(
      user,
      b.action === "archive"
        ? "Archived private inbox view"
        : "Saved private inbox view",
      String(id),
    );
    db.exec("COMMIT");
    return { id, unchanged: false };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
