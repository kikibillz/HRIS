#!/usr/bin/env node
// Trusted operator only. Never import application db.ts: inspection must not migrate or seed.
import { DatabaseSync, backup } from "node:sqlite";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  open,
  rm,
  stat,
} from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import {
  backupCipher,
  backupDecipher,
  backupHeaderSize,
  readBackupHeader,
} from "../lib/backup-format.ts";
const [command, ...args] = process.argv.slice(2),
  options = {};
let temp, createdOutput;
function fail(message) {
  throw Error(message);
}
function quote(name) {
  return '"' + name.replaceAll('"', '""') + '"';
}
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function digest(path) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}
function inspect(path) {
  const source = new DatabaseSync(path, { readOnly: true });
  try {
    source.exec(
      "PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000; BEGIN;",
    );
    const integrity = source.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok")
      fail("SQLite integrity check failed.");
    if (source.prepare("PRAGMA foreign_key_check").all().length)
      fail("SQLite foreign-key check failed.");
    const tables = source
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    for (const required of [
      "companies",
      "employees",
      "accounts",
      "payroll_runs",
    ])
      if (!tables.includes(required))
        fail(`Unsupported recovery database: missing ${required}.`);
    const counts = Object.fromEntries(
      tables.map((name) => [
        name,
        source.prepare(`SELECT COUNT(*) AS n FROM ${quote(name)}`).get().n,
      ]),
    );
    const content_sha256 = Object.fromEntries(
      tables.map((name) => {
        const keys = source
          .prepare(`PRAGMA table_info(${quote(name)})`)
          .all()
          .filter((c) => c.pk > 0)
          .sort((a, b) => a.pk - b.pk)
          .map((c) => quote(c.name));
        const hash = createHash("sha256");
        for (const row of source
          .prepare(
            `SELECT * FROM ${quote(name)} ORDER BY ${keys.length ? keys.join(",") : "rowid"}`,
          )
          .iterate())
          hash.update(
            JSON.stringify(row, (_, v) =>
              v instanceof Uint8Array ? Buffer.from(v).toString("base64") : v,
            ) + "\n",
          );
        return [name, hash.digest("hex")];
      }),
    );
    return {
      integrity: "ok",
      foreign_keys: "ok",
      counts,
      content_sha256,
      companies: source
        .prepare("SELECT id,name FROM companies ORDER BY id")
        .all(),
    };
  } finally {
    source.close();
  }
}
try {
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--input", "--output"].includes(args[i]) ||
      !args[i + 1] ||
      options[args[i]]
    )
      fail("Use unique --input/--output path options.");
    options[args[i]] = resolve(args[i + 1]);
  }
  if (!["create", "preview", "restore"].includes(command))
    fail(
      "Usage: node scripts/backup.mjs create --output new.hrisbackup | preview --input file.hrisbackup | restore --input file.hrisbackup --output NEW_DATA_DIRECTORY",
    );
  const passphrase = process.env.HRIS_BACKUP_PASSPHRASE;
  if (
    typeof passphrase !== "string" ||
    passphrase.length < 12 ||
    passphrase.length > 128
  )
    fail(
      "Set HRIS_BACKUP_PASSPHRASE to a private 12–128 character passphrase. It is never written to the backup or output.",
    );
  const live = resolve(
    process.env.HRIS_DATA_DIR || join(process.cwd(), "data"),
    "hris.sqlite",
  );
  temp = await mkdtemp(join(tmpdir(), "hris-recovery-"));
  await chmod(temp, 0o700);
  const plain = join(temp, "snapshot.sqlite");
  if (command === "create") {
    const output = options["--output"];
    if (!output || options["--input"]) fail("Create requires --output only.");
    if (await exists(output)) fail("Output exists; no backup was overwritten.");
    if (!(await exists(live)))
      fail("Existing database not found; no database was created.");
    const source = new DatabaseSync(live, { readOnly: true });
    try {
      await backup(source, plain);
    } finally {
      source.close();
    }
    await chmod(plain, 0o600);
    const report = inspect(plain),
      hash = await digest(plain),
      { header, cipher } = backupCipher("operator", passphrase);
    const handle = await open(output, "wx", 0o600);
    createdOutput = output;
    async function* encrypted() {
      yield header;
      for await (const chunk of createReadStream(plain))
        yield cipher.update(chunk);
      yield cipher.final();
      yield cipher.getAuthTag();
    }
    await pipeline(encrypted(), handle.createWriteStream());
    createdOutput = undefined;
    console.log(
      JSON.stringify({
        action: "backup-created",
        output,
        plaintext_sha256: hash,
        ...report,
      }),
    );
  } else {
    const input = options["--input"];
    if (!input) fail("Provide --input.");
    const length = (await stat(input)).size;
    if (length < backupHeaderSize + 16) fail("Invalid backup file.");
    const handle = await open(input, "r"),
      header = Buffer.alloc(backupHeaderSize),
      tag = Buffer.alloc(16);
    try {
      await handle.read(header, 0, header.length, 0);
      await handle.read(tag, 0, 16, length - 16);
    } finally {
      await handle.close();
    }
    const info = readBackupHeader(header);
    if (info.kind !== "operator")
      fail(
        "Company archives cannot restore credentials or a full database. Use an operator backup.",
      );
    try {
      await pipeline(
        createReadStream(input, { start: backupHeaderSize, end: length - 17 }),
        backupDecipher(header, tag, passphrase),
        createWriteStream(plain, { flags: "wx", mode: 0o600 }),
      );
    } catch {
      fail(
        "Backup authentication failed. Check passphrase and integrity. No live data was changed.",
      );
    }
    const report = inspect(plain),
      hash = await digest(plain);
    if (command === "preview") {
      if (options["--output"]) fail("Preview does not accept --output.");
      let current = null,
        current_error = null;
      if (await exists(live)) {
        try {
          current = inspect(live);
        } catch (e) {
          current_error =
            e instanceof Error
              ? e.message
              : "Current database could not be inspected.";
        }
      } else
        current_error =
          "Current database not found; no current comparison is available.";
      console.log(
        JSON.stringify({
          action: "restore-preview",
          backup_created: info.created,
          plaintext_sha256: hash,
          ...report,
          current_counts: current?.counts ?? null,
          current_error,
          differences: current
            ? Object.keys({ ...current.counts, ...report.counts })
                .filter(
                  (t) => current.content_sha256[t] !== report.content_sha256[t],
                )
                .map((table) => ({
                  table,
                  current: current.counts[table] ?? 0,
                  backup: report.counts[table] ?? 0,
                  content_changed: true,
                }))
            : [],
          live_data_changed: false,
          warning:
            "Full-database recovery is operator-only and includes all companies and password hashes. Restore writes a new data directory; active sessions and unused account links are revoked in that copy.",
        }),
      );
    } else {
      const output = options["--output"];
      if (!output) fail("Restore requires a NEW --output data directory.");
      if (await exists(output))
        fail(
          "Restore destination already exists. No existing directory or live database was changed.",
        );
      // Invalidate recovered bearer credentials only in the new copy; account/password rows stay intact.
      const restored = new DatabaseSync(plain);
      let revokedSessions = 0,
        revokedLinks = 0;
      try {
        restored.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
        if (report.counts.sessions !== undefined)
          revokedSessions = Number(
            restored.prepare("DELETE FROM sessions").run().changes,
          );
        if (report.counts.account_links !== undefined)
          revokedLinks = Number(
            restored
              .prepare(
                "UPDATE account_links SET used_at=? WHERE used_at IS NULL",
              )
              .run(Date.now()).changes,
          );
        restored.exec("COMMIT");
      } catch (e) {
        try {
          restored.exec("ROLLBACK");
        } catch {}
        throw e;
      } finally {
        restored.close();
      }
      const restoredReport = inspect(plain);
      await mkdir(dirname(output), { recursive: true });
      await mkdir(output, { mode: 0o700 });
      createdOutput = output;
      // Copy across filesystems safely; never rename over an existing live DB.
      const dest = join(output, "hris.sqlite");
      await pipeline(
        createReadStream(plain),
        createWriteStream(dest, { flags: "wx", mode: 0o600 }),
      );
      createdOutput = undefined;
      console.log(
        JSON.stringify({
          action: "recovery-copy-ready",
          output,
          source_plaintext_sha256: hash,
          restored_plaintext_sha256: await digest(dest),
          revoked_sessions: revokedSessions,
          revoked_unused_links: revokedLinks,
          ...restoredReport,
          live_data_changed: false,
          instructions:
            "Stop the old app, retain its data directory, and explicitly point HRIS_DATA_DIR at this recovered copy before restarting. No server was stopped or switched automatically.",
        }),
      );
    }
  }
} catch (error) {
  if (createdOutput) await rm(createdOutput, { recursive: true, force: true });
  console.error(
    error instanceof Error ? error.message : "Backup/recovery failed.",
  );
  process.exitCode = 1;
} finally {
  if (temp) await rm(temp, { recursive: true, force: true });
}
