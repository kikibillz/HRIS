# Private preview without paid deployment

Use the current app for learning and fictional-data testing before paying for hosting. No public domain, email/SMS provider, AI subscription or bank integration is required. This guide does not provision or enable paid services.

## Codespaces: check before starting another server

In your Codespace terminal, from the HRIS repository:

```bash
npm run preview:check
```

This checks Node, installed dependencies, the local port and the PeopleOS login/readiness responses. It reports whether a database already exists without opening, creating, repairing or deleting it. It does not install packages, kill processes, change port visibility or send messages. If Codespaces supplies its forwarding details, the report includes that Codespace's preview URL.

| Result | Next action |
| --- | --- |
| `ready` | Open **Ports → 3000 → Open in Browser** and keep visibility **Private**. If the browser still fails, record its error and the diagnostic report; forwarding/authentication may be the issue. |
| `stopped` | Run `npm run preview`. Wait for “PeopleOS is ready.” |
| `starting` | A process accepts connections but did not answer the app check in time. Wait for compilation and check the existing server terminal or `data/preview.log`. |
| `occupied` | The port answers with something other than the expected PeopleOS login. Inspect the existing process; diagnostics never stop it. |
| `unavailable` | The server answers but the app/database is not ready. Read its startup/compilation log; preserve the data directory. |
| `needs-install` | Run `npm run preview` to install locked dependencies and start the app. |
| `unsupported-node` | Use Node 24. The preview script tries the Codespaces Node setup; rebuilding the development container also installs the configured version. |

For a report suitable for copying into a support request:

```bash
npm run preview:check -- --json
```

The report does not contain employee records, credentials, database contents or server-response bodies. Do not include passwords or private staff data when sharing other logs/screenshots.

## Start and keep port 3000 open

```bash
npm run preview
```

The startup script installs locked dependencies when needed, starts port 3000, and waits for a real PeopleOS login response. A successful install is recorded against package.json, package-lock.json, .npmrc and the exact Node/platform runtime. Later starts reuse it only if those inputs, core package versions/binary and the local `npm ls` dependency-tree check still match. Concurrent starts use a lock before installing dependencies so they cannot replace each other's dependency directory. The lock is shared across preview ports because the dependency directory is shared. A failed install releases the lock. It preserves the database and existing accounts.

To force a clean dependency reinstall after stopping the preview server:

```bash
HRIS_PREVIEW_REINSTALL=1 npm run preview
```

This rebuilds dependencies, not the database. An already healthy server is reused; stop it first when you intend to reinstall.

If your environment stops detached processes, run the server directly in a terminal instead:

```bash
HRIS_ALLOW_SETUP=1 npm run dev -- --port 3000
```

**Leave that terminal running.** Setup is available only while a private workspace has no administrator; existing accounts/passwords are retained. Open the forwarded port from your own Codespaces Ports panel. A server running in the cloud coding workspace beside this chat is a different process on a different machine; its success does not prove your Codespace is running.

If startup reports an existing lock, inspect the other start and its terminal first. After a crashed start, confirm no installer/startup is still running before manually removing only the matching `data/.preview-start.lock` directory. Never delete `data/`, `hris.sqlite`, or account records to resolve a port problem.

## Updates and budget

Updates are pushed to GitHub. Preserve any local edits before pulling main in the Codespace, then rerun the diagnostic. The development server normally reloads changed application files; dependency changes may need a restart and `npm run preview`. This does not open the Codespaces browser or change your GitHub account settings automatically.

Codespaces availability and included usage depend on your GitHub account. Check your quota and spending settings before starting, keep port visibility Private, and stop the Codespace from GitHub when finished. Closing a browser tab or stopping just the Node server is not the same as stopping the Codespace. Do not assume unlimited free runtime or storage. The diagnostic reports app state, not quota or billing.

Alternatively, run the repository on a computer you already own with Node 24, Git and a compatible shell. Install dependencies with `npm ci`, use the foreground command above, and open `http://localhost:3000`. Keep that process running and retain the `data/` directory. This avoids cloud-hosting usage but is not a public production deployment.

## Data and acceptance

Use fictional staff and salaries during the preview. Complete the [pilot checklist](PILOT-ACCEPTANCE.md) and record defects. HR can check staff details and workflows; accountant/payroll-specialist review remains pending before real payroll use.

Create/download an encrypted backup using **Backups & recovery**, keep its passphrase separately, and store the encrypted file outside the Codespace on storage you already control. A Git commit saves code, not your live SQLite database. See [backup recovery](BACKUP-RECOVERY.md). Production backup timers remain unconfigured until an actual host and separate backup storage are chosen.
