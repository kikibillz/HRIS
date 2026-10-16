"use client";
import { useState } from "react";
import { api, dateTime } from "./types";
type Comparison = {
  created: string;
  changed_tables: number;
  message: string;
  comparison: {
    table: string;
    backup_rows: number;
    current_rows: number;
    changed: boolean;
  }[];
};
export default function BackupsPanel() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<Comparison | null>(null),
    [created, setCreated] = useState("");
  return (
    <>
      <section className="panel ops-form">
        <h2>Encrypted company archive</h2>
        <p>
          Includes this company’s employee records, documents, payroll, payment
          receipts and export history. Authentication password hashes, sessions
          and account links are excluded. Only a trusted server operator can
          back up and recover the full database across companies.
        </p>
        <p>
          This portable company archive supports review and comparison here. It
          cannot restore account credentials or replace database records. Keep
          the passphrase separately: it is not stored and cannot be recovered.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget,
              b = Object.fromEntries(new FormData(form));
            setBusy(true);
            setError("");
            setCreated("");
            try {
              if (b.passphrase !== b.confirm_passphrase)
                throw Error("Backup passphrases must match.");
              const response = await fetch("/api/backups", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "create",
                  passphrase: b.passphrase,
                  confirmed: b.confirmed === "on",
                }),
              });
              if (!response.ok) {
                const failure = await response.json();
                throw Error(failure.error);
              }
              const blob = await response.blob(),
                url = URL.createObjectURL(blob),
                link = document.createElement("a");
              link.href = url;
              link.download =
                response.headers
                  .get("Content-Disposition")
                  ?.match(/filename=([^;]+)/)?.[1] ?? "company.hrisbackup";
              document.body.appendChild(link);
              link.click();
              link.remove();
              setTimeout(() => URL.revokeObjectURL(url), 30000);
              setCreated(
                `Archive downloaded. SHA-256: ${response.headers.get("X-Backup-SHA256") ?? ""}`,
              );
              form.reset();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Archive failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            New backup passphrase
            <input
              type="password"
              name="passphrase"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </label>
          <label>
            Confirm backup passphrase
            <input
              type="password"
              name="confirm_passphrase"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </label>
          <label className="check-label">
            <input type="checkbox" name="confirmed" required />I will store this
            encrypted archive and its passphrase securely and separately.
          </label>
          <button className="primary" disabled={busy}>
            Download encrypted company archive
          </button>
        </form>
        {created && (
          <p role="status" className="ops-code">
            {created}
          </p>
        )}
      </section>
      <section className="panel ops-form">
        <h2>Compare company archive</h2>
        <p>
          Upload an encrypted archive from this company and workspace. The
          preview compares table counts and contents without replacing data.
          Operator database backups are rejected by this web interface.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget,
              b = new FormData(form),
              file = b.get("archive");
            setBusy(true);
            setError("");
            setResult(null);
            try {
              if (
                !(file instanceof File) ||
                !file.size ||
                file.size > 105 * 1024 * 1024
              )
                throw Error("Choose a company archive up to 105 MiB.");
              const bytes = new Uint8Array(await file.arrayBuffer());
              let binary = "";
              for (let i = 0; i < bytes.length; i += 32768)
                binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
              setResult(
                await api("backups", {
                  action: "preview",
                  archive: btoa(binary),
                  passphrase: b.get("passphrase"),
                }),
              );
              form.reset();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Comparison failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Encrypted company archive file
            <input type="file" name="archive" accept=".hrisbackup" required />
          </label>
          <label>
            Archive passphrase
            <input
              type="password"
              name="passphrase"
              minLength={12}
              maxLength={128}
              autoComplete="off"
              required
            />
          </label>
          <button className="secondary" disabled={busy}>
            Preview archive comparison
          </button>
        </form>
        {result && (
          <>
            <p role="status">
              Archive created {dateTime(result.created)}.{" "}
              {result.changed_tables} tables differ. {result.message}
            </p>
            <div className="ops-table">
              <table>
                <thead>
                  <tr>
                    <th>Table</th>
                    <th>Archive rows</th>
                    <th>Current rows</th>
                    <th>Content</th>
                  </tr>
                </thead>
                <tbody>
                  {result.comparison.map((r) => (
                    <tr key={r.table}>
                      <td>{r.table}</td>
                      <td>{r.backup_rows}</td>
                      <td>{r.current_rows}</td>
                      <td>{r.changed ? "Changed" : "Same"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      <section className="panel ops-form">
        <h2>Full database recovery — server operator</h2>
        <p>
          The operator CLI creates encrypted, consistent SQLite snapshots
          including every company, documents and account password hashes.
          Integrity and foreign-key checks run before use. Preview reports
          table-count and content differences. Restore creates a new data
          directory, revokes recovered sessions and unused account links, and
          preserves account passwords and business records. It never stops the
          app or replaces its live data directory.
        </p>
        <p>
          Run <code>npm run backup:create</code>,{" "}
          <code>npm run backup:preview</code> or{" "}
          <code>npm run backup:restore</code> with the documented path arguments
          and a private <code>HRIS_BACKUP_PASSPHRASE</code> environment
          variable. See <code>docs/BACKUP-RECOVERY.md</code> for the tested
          recovery procedure.
        </p>
      </section>
    </>
  );
}
