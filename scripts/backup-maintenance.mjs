#!/usr/bin/env node
// Operator-only scheduled backups. Never imports db.ts or switches a running database.
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const cli = fileURLToPath(new URL("./backup.mjs", import.meta.url));
const fail = (message) => {
  throw new Error(message);
};
const within = (parent, child) => {
  const part = relative(parent, child);
  return part === "" || (!part.startsWith("..") && !isAbsolute(part));
};
const pattern = /^hris-auto-[0-9T.Z-]+-[0-9a-f-]{36}\.hrisbackup$/;
async function digest(path) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest("hex");
}
async function privateFile(path) {
  const s = await lstat(path);
  if (
    !s.isFile() ||
    s.isSymbolicLink() ||
    s.mode & 0o077 ||
    s.uid !== process.getuid()
  )
    fail(
      "Backup key must be an owner-only regular file owned by the service user.",
    );
  return s;
}
async function command(args, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      size = 0;
    child.stdout.on("data", (b) => {
      size += b.length;
      if (size > 8 * 1024 * 1024) child.kill();
      else out += b;
    });
    child.stderr.resume();
    child.on("error", () => reject(Error("Unable to start backup CLI.")));
    child.on("exit", (code) => {
      if (code !== 0)
        return reject(
          Error(
            `Backup ${args[0]} failed; no retention cleanup was attempted.`,
          ),
        );
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(Error("Invalid backup CLI report."));
      }
    });
  });
}
async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
let lock,
  temp,
  destination,
  sourceId,
  started = new Date().toISOString();
try {
  if (
    Number(process.versions.node.split(".")[0]) !== 24 ||
    process.argv.length !== 2
  )
    fail(
      "Requires Node 24 and environment configuration; no arguments accepted.",
    );
  for (const key of [
    "HRIS_DATA_DIR",
    "HRIS_BACKUP_DIR",
    "HRIS_BACKUP_KEY_FILE",
  ])
    if (!process.env[key] || !isAbsolute(process.env[key]))
      fail(`Set ${key} to an existing absolute path.`);
  const source = await realpath(process.env.HRIS_DATA_DIR);
  destination = await realpath(process.env.HRIS_BACKUP_DIR);
  const sourceDb = await lstat(join(source, "hris.sqlite"));
  if (!sourceDb.isFile() || sourceDb.isSymbolicLink())
    fail("Existing regular source database required.");
  if (within(source, destination) || within(destination, source))
    fail("Backup destination must be separate from the live data directory.");
  const destInfo = await lstat(destination);
  if (
    !destInfo.isDirectory() ||
    destInfo.mode & 0o077 ||
    destInfo.uid !== process.getuid()
  )
    fail("Backup directory must be owner-only and owned by the service user.");
  const retention = Number(process.env.HRIS_BACKUP_RETENTION_DAYS || 30);
  if (!Number.isInteger(retention) || retention < 1 || retention > 3650)
    fail("Retention must be an integer from 1 to 3650 days.");
  let destinationKind = "local-test";
  if (process.env.HRIS_BACKUP_ALLOW_LOCAL !== "1") {
    if (
      !process.env.HRIS_BACKUP_MOUNT ||
      !isAbsolute(process.env.HRIS_BACKUP_MOUNT)
    )
      fail(
        "Set HRIS_BACKUP_MOUNT to the actual mounted backup filesystem. Local testing requires explicit HRIS_BACKUP_ALLOW_LOCAL=1.",
      );
    const mount = await realpath(process.env.HRIS_BACKUP_MOUNT);
    const mounts = (await readFile("/proc/self/mountinfo", "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) =>
        line
          .split(" ")[4]
          .replace(/\\([0-7]{3})/g, (_, oct) =>
            String.fromCharCode(parseInt(oct, 8)),
          ),
      );
    if (
      mount === "/" ||
      !mounts.includes(mount) ||
      !within(mount, destination) ||
      within(mount, source)
    )
      fail(
        "Backup mount is unavailable or also contains live storage. Refusing local fallback.",
      );
    destinationKind = "mounted-destination";
  }
  await privateFile(process.env.HRIS_BACKUP_KEY_FILE);
  const keyPath = await realpath(process.env.HRIS_BACKUP_KEY_FILE);
  if (within(destination, keyPath))
    fail("Keep the backup key outside the archive destination.");
  const passphrase = (
    await readFile(process.env.HRIS_BACKUP_KEY_FILE, "utf8")
  ).replace(/\r?\n$/, "");
  if (
    passphrase.length < 12 ||
    passphrase.length > 128 ||
    /[\r\n]/.test(passphrase)
  )
    fail("Backup key file must contain one 12–128 character passphrase.");
  const lockPath = join(destination, ".hris-backup.lock");
  try {
    await mkdir(lockPath, { mode: 0o700 });
    lock = lockPath;
  } catch {
    fail(
      "Another backup may be running. Inspect the backup lock; it is never removed automatically.",
    );
  }
  sourceId = createHash("sha256").update(source).digest("hex");
  temp = await mkdtemp(join(tmpdir(), "hris-backup-drill-"));
  await chmod(temp, 0o700);
  const filename = `hris-auto-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.hrisbackup`,
    archive = join(destination, filename);
  const env = {
    ...process.env,
    HRIS_DATA_DIR: source,
    HRIS_BACKUP_PASSPHRASE: passphrase,
  };
  const created = await command(["create", "--output", archive], env);
  const restored = await command(
    ["restore", "--input", archive, "--output", join(temp, "recovered")],
    env,
  );
  if (
    created.integrity !== "ok" ||
    restored.integrity !== "ok" ||
    created.foreign_keys !== "ok" ||
    restored.foreign_keys !== "ok" ||
    created.plaintext_sha256 !== restored.source_plaintext_sha256
  )
    fail("Backup restore verification failed.");
  const report = {
    format: "hris-backup-maintenance-v1",
    source_id: sourceId,
    archive: filename,
    created: new Date().toISOString(),
    archive_sha256: await digest(archive),
    plaintext_sha256: created.plaintext_sha256,
    restored_sha256: restored.restored_plaintext_sha256,
    integrity: "ok",
    foreign_keys: "ok",
    restore_drill: true,
    destination_kind: destinationKind,
    live_data_changed: false,
  };
  await atomicJson(`${archive}.verified.json`, report);
  await atomicJson(join(destination, "last-success.json"), report);
  // Delete only this source's old, verified, unchanged managed archives after a successful drill.
  let pruned = 0,
    skipped = 0;
  for (const entry of await readdir(destination)) {
    if (!entry.endsWith(".hrisbackup.verified.json")) continue;
    const name = entry.slice(0, -".verified.json".length);
    if (!pattern.test(name) || name === filename) continue;
    const manifestPath = join(destination, entry),
      oldArchive = join(destination, name);
    try {
      const info = await lstat(manifestPath);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      const old = JSON.parse(await readFile(manifestPath, "utf8"));
      if (
        old.format !== report.format ||
        old.source_id !== sourceId ||
        old.archive !== name ||
        old.restore_drill !== true ||
        !Number.isFinite(Date.parse(old.created)) ||
        Date.parse(old.created) >= Date.now() - retention * 86400000
      )
        continue;
      const a = await lstat(oldArchive);
      if (
        !a.isFile() ||
        a.isSymbolicLink() ||
        (await digest(oldArchive)) !== old.archive_sha256
      ) {
        skipped++;
        continue;
      }
      await rm(oldArchive);
      await rm(manifestPath);
      pruned++;
    } catch {
      skipped++;
    }
  }
  const status = {
    status: "ok",
    started,
    finished: new Date().toISOString(),
    archive: filename,
    destination_kind: destinationKind,
    restore_drill: true,
    pruned,
    skipped,
    live_data_changed: false,
  };
  await atomicJson(join(destination, "last-attempt.json"), status);
  console.log(JSON.stringify(status));
} catch (e) {
  const message = e instanceof Error ? e.message : "Backup maintenance failed.";
  if (lock && destination)
    try {
      await atomicJson(join(destination, "last-attempt.json"), {
        status: "failed",
        started,
        finished: new Date().toISOString(),
        error: message,
        live_data_changed: false,
      });
    } catch {}
  console.error(message);
  process.exitCode = 1;
} finally {
  if (temp) await rm(temp, { recursive: true, force: true });
  if (lock) await rm(lock, { recursive: true, force: true });
}
