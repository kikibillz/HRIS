import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const exec = promisify(execFile),
  dir = await mkdtemp(join(tmpdir(), "hris-preview-check-"));
const server = createServer();
let mode = "ready";
server.on("request", (req, res) => {
  if (mode === "starting") return;
  if (mode === "occupied") {
    res.end("Unrelated private response - never print this");
    return;
  }
  if (mode === "error") {
    res.writeHead(500);
    res.end("Internal error - never print this");
    return;
  }
  if (req.url === "/login") {
    res.end("<html>PeopleOS Welcome back.</html>");
    return;
  }
  res.writeHead(mode === "unavailable" ? 503 : 200, {
    "Content-Type": "application/json",
  });
  res.end(
    JSON.stringify({
      status: mode === "unavailable" ? "unavailable" : "ready",
    }),
  );
});
let port;
async function run(extra = {}) {
  let r;
  try {
    r = await exec(process.execPath, ["scripts/preview-check.mjs", "--json"], {
      env: {
        ...process.env,
        HRIS_DATA_DIR: dir,
        HRIS_PREVIEW_PORT: String(port),
        CODESPACE_NAME: "test-preview",
        GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
        ...extra,
      },
      timeout: 15000,
    });
  } catch (e) {
    r = e;
  }
  assert(!String(r.stdout).includes("never print this"));
  return { code: r.code || 0, report: JSON.parse(r.stdout) };
}
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  let r = await run();
  assert.equal(r.code, 0);
  assert.equal(r.report.status, "ready");
  assert.equal(r.report.existing_database, false);
  assert.equal(
    r.report.codespace_url,
    `https://test-preview-${port}.app.github.dev/`,
  );
  assert.deepEqual(
    await readdir(dir),
    [],
    "Diagnostics must not initialize data",
  );
  for (const [next, status] of [
    ["occupied", "occupied"],
    ["error", "unavailable"],
    ["unavailable", "unavailable"],
    ["starting", "starting"],
  ]) {
    mode = next;
    r = await run();
    assert.equal(r.code, 1);
    assert.equal(r.report.status, status);
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  r = await run();
  assert.equal(r.report.status, "stopped");
  assert.equal(r.code, 1);
  assert.deepEqual(await readdir(dir), []);
  console.log(
    "PASS: preview ready/stopped/occupied/starting/unavailable diagnostics, private Codespace link and no database initialization or response-content disclosure.",
  );
} finally {
  server.closeAllConnections();
  server.close();
  await rm(dir, { recursive: true, force: true });
}
