import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { currentUser, requireUser } from "@/lib/auth";
import { audit } from "@/lib/tenant";
import {
  exportSettings,
  parseExportSettings,
  preparePayrollExport,
  profileFields,
} from "@/lib/payroll-exports";
import { zipFiles } from "@/lib/zip";
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Please sign in." }, { status: 401 });
  if (user.access !== "admin")
    return Response.json(
      { error: "Administrator access required." },
      { status: 403 },
    );
  try {
    const q = new URL(request.url).searchParams,
      artifact = q.get("artifact_id");
    if (artifact !== null) {
      const id = Number(artifact);
      if (!Number.isSafeInteger(id) || id < 1) throw Error("Invalid artifact.");
      const record = db
        .prepare(
          "SELECT * FROM payroll_export_artifacts WHERE id=? AND company_id=?",
        )
        .get(id, user.company_id) as
        | { payload: string; sha256: string; kind: string; run_id: number }
        | undefined;
      if (!record)
        return Response.json({ error: "Export not found." }, { status: 404 });
      const payload = JSON.parse(record.payload);
      return new Response(
        new Uint8Array(
          zipFiles({
            ...payload.files,
            "manifest.json": JSON.stringify(
              { ...payload.manifest, artifact_sha256: record.sha256 },
              null,
              2,
            ),
          }),
        ),
        {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename=hris-${record.run_id}-${record.kind}-${id}.zip`,
            "Cache-Control": "no-store",
          },
        },
      );
    }
    const run = Number(q.get("run_id"));
    if (!Number.isSafeInteger(run) || run < 1)
      throw Error("Choose a released payroll run.");
    const ready = preparePayrollExport(
      user.company_id,
      run,
      q.get("kind") ?? "bank",
    );
    return Response.json(
      {
        errors: ready.errors,
        settings: exportSettings(user.company_id),
        staff: ready.staff,
        artifacts: db
          .prepare(
            "SELECT id,kind,sha256,created FROM payroll_export_artifacts WHERE company_id=? AND run_id=? ORDER BY id DESC",
          )
          .all(user.company_id, run),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Export failed." },
      { status: 400 },
    );
  }
}
export async function POST(request: Request) {
  const user = await requireUser(request, true);
  if (user instanceof Response) return user;
  try {
    const b = await request.json();
    if (b.action === "settings") {
      const settings = parseExportSettings(b);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          "INSERT INTO payroll_export_settings(company_id,data) VALUES(?,?) ON CONFLICT(company_id) DO UPDATE SET data=excluded.data",
        ).run(user.company_id, JSON.stringify(settings));
        audit(
          user,
          "Payroll export template updated",
          "Generic bank columns and employer references",
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return Response.json({ ok: true });
    }
    if (!Number.isSafeInteger(b.run_id) || b.run_id < 1)
      throw Error("Choose a released payroll run.");
    db.exec("BEGIN IMMEDIATE");
    try {
      if (b.action === "profile") {
        preparePayrollExport(user.company_id, b.run_id, "bank");
        if (
          !Number.isSafeInteger(b.employee_id) ||
          !db
            .prepare(
              "SELECT id FROM payroll_items WHERE run_id=? AND employee_id=?",
            )
            .get(b.run_id, b.employee_id)
        )
          throw Error("Employee not found in this released payroll.");
        const data = Object.fromEntries(
          profileFields.map((k) => {
            const value = b[k] ?? "";
            if (typeof value !== "string" || value.length > 120)
              throw Error(
                "Export identifiers must be text up to 120 characters.",
              );
            return [k, value.trim()];
          }),
        );
        if (data.bank_account && !/^\d{10}$/.test(data.bank_account))
          throw Error("Account number must have 10 digits.");
        if (data.bank_code && !/^\d{3,6}$/.test(data.bank_code))
          throw Error("Bank code must contain 3–6 digits.");
        if (
          typeof b.reference !== "string" ||
          !b.reference.trim() ||
          b.reference.length > 1000 ||
          b.confirmed !== true
        )
          throw Error(
            "Confirm identifier review and provide a source reference.",
          );
        const before = db
          .prepare(
            "SELECT data,reference FROM payroll_export_profiles WHERE company_id=? AND run_id=? AND employee_id=?",
          )
          .get(user.company_id, b.run_id, b.employee_id);
        db.prepare(
          "INSERT INTO payroll_export_profiles(company_id,run_id,employee_id,data,reference,updated_by) VALUES(?,?,?,?,?,?) ON CONFLICT(company_id,run_id,employee_id) DO UPDATE SET data=excluded.data,reference=excluded.reference,updated_by=excluded.updated_by",
        ).run(
          user.company_id,
          b.run_id,
          b.employee_id,
          JSON.stringify(data),
          b.reference.trim(),
          user.id,
        );
        audit(
          user,
          "Payroll export identifiers reviewed",
          JSON.stringify({
            run: b.run_id,
            employee: b.employee_id,
            before: before ?? null,
            after: { data, reference: b.reference.trim() },
          }),
        );
      } else if (b.action === "create") {
        if (b.confirmed !== true)
          throw Error("Confirm the export has been reviewed.");
        const ready = preparePayrollExport(user.company_id, b.run_id, b.kind);
        if (ready.errors.length) throw Error(ready.errors.join(" "));
        const manifest = {
          company_id: user.company_id,
          run_id: b.run_id,
          period: ready.period,
          kind: b.kind,
          generated_at: new Date().toISOString(),
          settings: ready.settings,
          identifiers: ready.staff,
          balances: {
            salary: ready.summary.salaries,
            obligations: ready.summary.obligations,
          },
          legacy_salary_batch: ready.summary.legacy,
          file_sha256: Object.fromEntries(
            Object.entries(ready.files).map(([name, value]) => [
              name,
              createHash("sha256").update(value).digest("hex"),
            ]),
          ),
        };
        const payload = JSON.stringify({ files: ready.files, manifest }),
          sha256 = createHash("sha256").update(payload).digest("hex");
        const id = Number(
          db
            .prepare(
              "INSERT INTO payroll_export_artifacts(company_id,run_id,kind,payload,sha256,created_by) VALUES(?,?,?,?,?,?)",
            )
            .run(user.company_id, b.run_id, b.kind, payload, sha256, user.id)
            .lastInsertRowid,
        );
        audit(
          user,
          "Payroll export pack generated",
          `${id}: ${b.kind}: ${sha256}`,
        );
        db.exec("COMMIT");
        return Response.json({ ok: true, id });
      } else throw Error("Invalid export action.");
      db.exec("COMMIT");
      return Response.json({ ok: true });
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Export failed." },
      { status: 400 },
    );
  }
}
