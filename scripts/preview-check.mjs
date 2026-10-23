#!/usr/bin/env node
// Read-only preview diagnostics; never installs dependencies, kills servers or initializes SQLite.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url)),
  require = createRequire(join(root, "package.json"));
const raw = process.env.HRIS_PREVIEW_PORT || "3000",
  port = Number(raw);
if (
  !/^\d+$/.test(raw) ||
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  process.argv.slice(2).some((x) => x !== "--json")
) {
  console.error(
    "Use HRIS_PREVIEW_PORT from 1 to 65535, and optionally --json.",
  );
  process.exit(1);
}
const node = Number(process.versions.node.split(".")[0]) >= 24;
let dependencies = false;
try {
  require.resolve("next/package.json");
  require.resolve("typescript/package.json");
  dependencies = true;
} catch {}
const listening = () =>
  new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(value);
      }
    };
    socket.setTimeout(1000, () => finish(false));
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
  });
let server = "stopped";
try {
  const login = await fetch(`http://127.0.0.1:${port}/login`, {
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
    }),
    html = await login.text();
  if (
    login.ok &&
    html.includes("PeopleOS") &&
    (html.includes("Welcome back.") ||
      html.includes("Make this workspace yours."))
  ) {
    try {
      const health = await fetch(`http://127.0.0.1:${port}/api/health/ready`, {
        signal: AbortSignal.timeout(5000),
        redirect: "manual",
      });
      server =
        health.ok && (await health.json()).status === "ready"
          ? "ready"
          : "unavailable";
    } catch {
      server = "unavailable";
    }
  } else server = login.status >= 500 ? "unavailable" : "occupied";
} catch {
  server = (await listening()) ? "starting" : "stopped";
}
const status = !node
  ? "unsupported-node"
  : !dependencies
    ? "needs-install"
    : server;
const nextSteps = {
  ready: [
    `Open Ports → ${port} → Open in Browser. Keep the port Private. If it still fails, copy the browser error and this report.`,
    "If this is a cloud coding workspace, run the check in your Codespace too: they are separate machines.",
  ],
  stopped: [
    "Start the preview in this workspace: npm run preview",
    `To keep the server attached to your terminal: npm run dev -- --port ${port}. Leave that terminal running.`,
  ],
  starting: [
    "The port accepts connections but the app did not answer in time. Wait for compilation to finish, then rerun this check.",
    "Inspect the existing server terminal or data/preview.log; do not start a second server on the same port.",
  ],
  occupied: [
    `Port ${port} answers but does not serve the PeopleOS login page. Inspect the process using this port; this tool will not stop it.`,
  ],
  unavailable: [
    "The server answered but the app or database is not ready. Inspect the existing server terminal or data/preview.log.",
    "Do not delete the database or reset accounts to fix a preview error.",
  ],
  "needs-install": [
    "Dependencies are missing or incomplete. Run npm run preview to install the locked dependencies and start the app.",
  ],
  "unsupported-node": [
    "Use Node.js 24. In Codespaces, rebuild the development container or run npm run preview to use its Node setup.",
  ],
};
const report = {
  status,
  port,
  node_version: process.versions.node,
  dependencies_present: dependencies,
  server,
  existing_database: existsSync(
    join(
      resolve(process.env.HRIS_DATA_DIR || join(root, "data")),
      "hris.sqlite",
    ),
  ),
  next_steps: nextSteps[status],
};
if (
  /^[a-z0-9-]+$/i.test(process.env.CODESPACE_NAME || "") &&
  /^[a-z0-9.-]+$/i.test(
    process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "",
  )
)
  report.codespace_url = `https://${process.env.CODESPACE_NAME}-${port}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}/`;
if (process.argv.includes("--json")) console.log(JSON.stringify(report));
else {
  console.log(
    `PeopleOS preview: ${status}\nPort: ${port}\nNode: ${report.node_version}\nDependencies: ${dependencies ? "present" : "missing"}\nExisting database: ${report.existing_database ? "present" : "not found (nothing created)"}`,
  );
  if (report.codespace_url)
    console.log(`Codespace link: ${report.codespace_url}`);
  for (const step of report.next_steps) console.log(`- ${step}`);
}
process.exitCode = status === "ready" ? 0 : 1;
