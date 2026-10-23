import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  access,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
const exec = promisify(execFile),
  root = await mkdtemp(join(tmpdir(), "hris-preview-start-"));
try {
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "bin"));
  await copyFile(
    "scripts/start-preview.sh",
    join(root, "scripts/start-preview.sh"),
  );
  const marker = join(root, "installs");
  await writeFile(
    join(root, "bin/npm"),
    '#!/bin/bash\nprintf "install\\n" >> "$PREVIEW_TEST_MARKER"\nsleep 3\nexit 1\n',
    { mode: 0o700 },
  );
  const probe = createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const env = {
    ...process.env,
    PATH: join(root, "bin") + ":" + process.env.PATH,
    HRIS_PREVIEW_PORT: String(port),
    PREVIEW_TEST_MARKER: marker,
  };
  const start = async (overrides = {}) => {
    try {
      return await exec("bash", [join(root, "scripts/start-preview.sh")], {
        env: { ...env, ...overrides },
        timeout: 15000,
      });
    } catch (e) {
      return e;
    }
  };
  const first = start();
  let installing = false;
  for (let i = 0; i < 70; i++) {
    try {
      await access(marker);
      installing = true;
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(installing, "First start reached the fake installer");
  const second = await start();
  assert.equal(second.code, 1);
  assert.match(second.stderr, /Another preview start/);
  assert.equal(
    (await readFile(marker, "utf8")).trim(),
    "install",
    "Only one installer may run",
  );
  assert.equal((await first).code, 1);
  let locked = true;
  try {
    await access(join(root, "data", `.preview-start-${port}.lock`));
  } catch {
    locked = false;
  }
  assert.equal(locked, false, "Failed installation releases startup lock");
  for (const invalid of ["0", "65536", "999999999999999999999", "invalid"])
    assert.match(
      (await start({ HRIS_PREVIEW_PORT: invalid })).stderr,
      /must be a port number/,
    );
  console.log(
    "PASS: preview startup serializes dependency installs, releases lock after failure, and rejects invalid ports.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
