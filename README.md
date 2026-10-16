# PeopleOS HRIS

A working HR suite built with Next.js, React, TypeScript, and local SQLite. It includes company signup and isolation, staff imports, Nigeria 2026 payroll and payslips with reviewed period adjustments, attendance, documents, recruiting, goals/reviews/360 feedback, learning, onboarding, letters, notifications, analytics, and a company policy assistant. Existing employee, leave, manager approval, invitation, password, and recovery workflows are preserved. Core workflows and policy search run locally; generated AI answers require a configured AI Gateway account.

## HR operations and first payroll

Open **HR operations & self-service** from the existing workspace, or visit `/operations`. New companies register at `/signup` and follow **Company launch → Staff import → Payroll & payslips**. Download the CSV template and calculation review workbook inside the app. Employees use the same website on their phone for leave, clock-in/out, released payslips, learning, and notifications.

Read [HR suite workflows, payroll scope, external configuration, and acceptance evidence](docs/HR-SUITE.md). Payroll reference cases are **not accountant-approved**; the 100% accountant-agreement target still needs professional review. Payments currently provide bank export and recording of payments made externally, rather than live money movement.

## Review the app in your browser

1. On this repository's GitHub page, select **Code → Codespaces → Create codespace on main**.
2. Wait for setup to install dependencies and start the development server.
3. In the **Ports** panel, open port **3000** in your browser. Keep its visibility **Private**.
4. Create your first administrator account on the setup screen, using a unique password of at least 12 characters. Setup closes after that account exists.
5. Choose **Employees → Add employee** to create employee and manager accounts with passwords you choose. Choose **Create invitation link** under **Account setup** to let the employee choose their own password. Share the link privately; email delivery is not configured. Initial-password setup remains available. Do not use real staff data yet.
6. Open **Leave requests**. Submit a request as an employee, then sign in as an assigned manager or administrator to review it. Administrators choose approvers with **Employees → Change approver**. Expand a request in **Request history** to see its reason, decisions, reviewer, and timestamps.

GitHub Codespaces has account-dependent free quotas. Check your remaining quota and spending settings, and stop the Codespace when finished. This configuration uses the standard default machine size and requires no paid extensions. A Codespace cannot be promised to be free for every account.

Cloud coding sessions and Codespaces are separate copies of the repository. After a new update is pushed here, run `git pull origin main` in the Codespaces terminal; the running development server will reload the changes. Preserve your local edits before pulling. Changes edited directly inside the Codespace appear through live reload. Creating the Codespace and opening its authenticated preview must be done from your GitHub account; it has not been launched by this coding environment.

## If an existing Codespaces preview shows an error

Open its terminal in the HRIS repository and run this single command:

```sh
git pull --ff-only origin main && npm ci && bash scripts/start-preview.sh
```

The startup helper checks Node.js, activates Node 24 through the Codespaces-provided nvm when needed, installs locked dependencies, starts a detached server, and verifies the real sign-in page before printing the app link. It preserves accounts and SQLite data. It is safe to rerun if the app is already healthy, and it will not stop an unrelated process on port 3000. Startup failures are shown in the terminal and saved to ignored `data/preview.log`. New containers run this helper automatically.

## Local development

Requires Node.js 24 and npm 11. SQLite is provided by Node itself.

```sh
npm ci
HRIS_ALLOW_SETUP=1 npm run dev
```

`HRIS_ALLOW_SETUP=1` permits creation of the first administrator only when no accounts exist. It is enabled by the private Codespaces preview command. Initialize your account before exposing a server publicly, then restart without this flag. A normal server without an administrator or this flag shows sign-in but does not permit public account creation.

The default port is 3000. SQLite is created and seeded automatically at `data/hris.sqlite`; this directory is ignored by Git. `HRIS_DATA_DIR` selects a different local storage directory. Existing prototype records are preserved by additive schema migrations. Preserve the database to retain your accounts, requests, and history. Do not delete it unless intentionally resetting the whole sample workspace.

```sh
npm run build
npm run typecheck
npm test
npm start
```

`npm test` requires Python 3. It first verifies migration from an existing database without changing any original records, then starts a production server on port 3101 with its own temporary database and checks login, authorization, date validation, balances, overlaps, decisions, cancellation, and audit history. Run a build first. It never uses your working database.

Optional real-browser tests require Python Playwright (`pip install playwright`) and system Chromium. Set `CHROMIUM_PATH` if it is not at `/usr/bin/chromium`, then run `python3 tests/browser.py` after a build. They use a separate temporary database and port 3102. Screenshots go to `/tmp/hris-review/`.

## Leave workflow and current policy

- Employees submit and cancel their own pending requests and see only their own leave reasons and history. Their workspace includes a read-only own profile, balances, requests, cancellation, and history. Other employees, the directory, and department counts are excluded server-side from employee page data. Managers and administrators retain their existing directory and team access.
- Managers can see leave reasons/history and review requests only for their directly assigned employees. Administrators assign or remove managers using **Employees → Change approver**. Unassigned employees use administrator review. Reassignment moves access to existing requests and history immediately; manager assignment changes are audited. Administrators also manage employees and departments and can submit leave on behalf of an employee. Nobody can approve or decline their own request.
- Annual leave: 20 days; sick leave: 10 days; personal leave: 5 days per calendar year. These are **prototype allowances**, not claims about statutory entitlements.
- Counts use Monday–Friday, excluding weekends. Public holidays, carry-over, prorating, and custom policies are not implemented.
- Pending requests reserve days; approved requests consume them. Declining or cancelling releases reserved days. Only pending requests can change state.
- Dates must be today or later, in one calendar year, this year or next. Requests cannot overlap other pending or approved requests.
- Submission and decisions record the actor and time. Declining requires a reason. Old prototype requests are identified as imports without invented history.
- Passwords are salted and hashed with scrypt. Session cookies are HttpOnly, SameSite=Lax, expire after eight hours, and use Secure when requests originate from HTTPS. Sign-out revokes the session. Mutations validate the request origin; repeated failed sign-ins are limited per email.

## What comes next

This is a functioning development prototype, not a production HR service. Before broad production rollout, complete accountant signoff, advanced/variable payroll cases, connected payouts/remittances, configurable leave policies, backup/restore operations, and a security review. See the HR suite scope document for precise implemented flows and remaining boundaries.

The app supports isolated companies. Existing records remain in the original workspace, with account IDs, passwords, requests, and reporting lines preserved. Managers review only directly assigned employees; indirect reporting chains do not grant leave access. New reporting lines start unassigned. Sample people use fictional `.demo` email addresses and have no seeded login passwords. Only accounts you explicitly create can sign in.

## Passwords, invitations, and recovery

- All signed-in users can use **Account security** to change their own password by confirming their current password. Five incorrect current-password attempts trigger a 15-minute pause. Successful changes sign out every session and invalidate outstanding account links.
- Administrators can invite a new employee using **Add employee → Account setup → Create invitation link**, or invite an existing person without an account using **Employees → Invite employee**. The account is created only when the employee sets a password. Invitations expire after 48 hours. Invitation roles are limited to employee or manager.
- For existing accounts, **Employees → Recovery link** creates a one-use reset link that expires after one hour. Verify the employee’s identity before sharing. Issuing a link leaves their current password and sessions working; redeeming it changes the password, signs out all their sessions, and preserves their role, reporting relationships, leave data, and account identity.
- Links appear once in the dialog, can be copied, and must be shared privately. No email is sent. Reissuing a link invalidates earlier links. **Revoke outstanding links** cancels unused links without changing the password. Treat these links as credentials.
- Link tokens are stored only as SHA-256 hashes. Tokens travel in the URL fragment, are removed from browser history when opened, and are consumed atomically when the password is saved. Refreshing the password page requires reopening the original link. Account-link and password actions are audited without storing plaintext passwords or tokens.
- **Forgot password?** on sign-in explains the administrator-assisted process. If the only administrator is locked out, a trusted workspace operator with access to the existing database can run this from the HRIS terminal (use the real administrator email and exact app origin):

```sh
node scripts/recover-admin.mjs admin@example.com https://your-workspace-origin
```

The operator command issues a one-hour reset link, records the action, and preserves the current password until redemption. `HRIS_DATA_DIR` can select the existing database directory. Run the updated app once before using the command so the additive account-link tables exist. This is a manual operator procedure, not a public recovery endpoint. Never delete the database to recover an account.

`npm test` also runs isolated account lifecycle tests on port 3103. Optional account browser checks: `python3 tests/accounts-browser.py` (port 3104). Both use temporary databases.

API: POST/DELETE `/api/auth`, POST/PATCH `/api/employees`, POST `/api/departments`, POST/PATCH `/api/leaves`, POST `/api/password`, POST/DELETE `/api/account-links`, POST `/api/account-links/redeem`. All workforce mutations require authentication and enforce roles server-side.

Period payroll now supports calendar-day starter proration, bonuses and one-off deductions. Bonuses/partial months require reviewed PAYE or explicitly selected cumulative mode with complete history, evidence confirmation and a method reference. See `docs/HR-SUITE.md` and the workbook’s Period review sheet.

Payroll YTD reconciliation now supports reviewed opening balances, approved/paid totals, per-payslip YTD snapshots, and administrator CSV export. Employees see only their own totals. Released payroll accepts an immutable external-review evidence record bound to its calculation fingerprint. Opening balances alone do not change PAYE, and external review records do not verify accountant identity; see `docs/HR-SUITE.md`.

Cumulative PAYE is now opt-in per employee/month, with authoritative prior balances, an explicit calendar-month annualisation method, exact-kobo rounding, preview and frozen tax working. Incomplete history, automatic refunds and negative-net catch-up are blocked. The method and 11 independent engineering cases remain pending accountant approval; see `docs/HR-SUITE.md` for the formula and scope.

Payments use bank exports and manual reconciliation. Released payroll supports per-employee partial salary receipts, separate statutory receipts, outstanding balances, reconciliation CSVs and append-only correction records. All payment evidence is administrator-only and audited; recording/voiding does not transfer or refund money. Legacy batch-payment records and frozen payslips remain preserved.

Released payroll now generates immutable generic bank and statutory preparation ZIP packs with readiness checks, configurable column mappings, reviewed export-only identifiers, exact NGN formatting and manifest checksums. Admin-only pack history preserves past exports after later reconciliation changes. These are preparation formats requiring external portal review; they do not submit filings or transfer money.

Backups & recovery now provides encrypted company-only archive downloads and read-only content comparisons. The operator CLI creates consistent, encrypted full SQLite snapshots and prepares verified recovery copies in new directories without replacing live data. Recovered copies revoke sessions/unused links while preserving account passwords and business records. See `docs/BACKUP-RECOVERY.md`; backups are manual and must be copied offsite.

Production containers, health checks, persistent storage, HTTPS proxy setup and CI are documented in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Company launch now includes an administrator-only checklist for a selected 2026 payroll month. It derives progress from eligible active staff, saved compensation or exclusions, statutory settings, calculated payroll, release status, and external review evidence matched to the frozen payroll snapshot. Use **Refresh checklist** after updating records. Staff-import and payroll links open the existing workflows; the checklist does not approve payroll, send payments, or certify calculations. Employees and managers retain their existing self-service access and cannot read company setup details.

Administrators can use **Onboarding templates** to save immutable starter checklists (up to 20 tasks), with calendar-day offsets from −30 to 365 days, and assign them to up to 50 active company employees at once. Assignments create ordinary onboarding tasks, in-app notifications, and audit entries in one transaction. Retrying the same template, employee and start date skips the existing assignment. Archive old templates to prevent new assignments; existing tasks and completion history remain available. Employees and assigned managers retain their existing task permissions. Templates, assignment provenance, and tasks are included in existing company backups.

**Onboarding progress** is available to administrators and managers. Administrators see their company's active starters; managers see only employees currently assigned to them, enforced by the API. The latest 100 generated checklists show completion, overdue counts, and the earliest open due date. Use **Send reminder** to create an in-app notification for overdue open tasks. Reminders are manual, audited, and limited to one per checklist per Africa/Lagos calendar day across all senders, including concurrent retries. Tasks due today are not overdue; completed tasks and inactive employees are excluded. Existing tasks and account permissions remain unchanged.

Administrators can enable **Reminder automation** per company and choose a daily Lagos send hour. Production supervises a worker that polls every minute; development can use `npm run reminders:watch` with an existing absolute `HRIS_DATA_DIR`. Automatic and manual reminders share persistent duplicate protection. The delivery monitor reports heartbeat freshness, job outcomes, inbox creation, and read marks. Existing companies remain opted out until enabled. See [deployment instructions](docs/DEPLOYMENT.md#automatic-onboarding-reminders).

**Interview scorecards** lets administrators assign company interviewers, collect final 1–5 ratings with evidence notes and human recommendations, and request a separate active manager or administrator's hiring approval. Interviewers see only their own assigned candidates and scorecards. Nominated managers see only their assigned requests and their frozen evidence. Submitted scorecards and completed decisions are immutable; company audit logs and backups include the evidence and decisions.

New transitions to **Offer** or **Hired** require the latest request to be approved against the current candidate, open job, and submitted scorecards. Candidate or job changes and new interview assignments can invalidate approval; reject stale pending requests and request fresh review. Existing applicant records and stages are preserved, including legacy hired candidates. Hiring decisions do not automatically create employees, accounts, offers, or outbound messages. Ratings support human review and never automatically advance or reject a candidate.

**Candidate handoff** is an administrator-only preview-and-confirm workflow for Hired candidates with a recorded hiring approval. HR can create a unique employee record using a reviewed work email, job title, department and start date, or explicitly link an active employee in the same company. Linking never overwrites the employee profile, account, password, access role, compensation or history. No account or invitation is created; manage account access separately through the existing invitation workflow.

An optional active onboarding template is assigned atomically with the handoff. The preview shows calendar due dates or the actual tasks and completion state of an existing matching checklist. Stale previews are rejected, failures roll back employee creation and assignment together, and concurrent retries return the existing handoff. Completed handoffs preserve an immutable snapshot and appear in audit records and company backups. Historical hires without recorded approvals remain unchanged and can use the existing employee/import workflows.

**Offer letters** issues immutable candidate letters from active company letter templates for candidates at the Offer stage with current hiring approval. It supports candidate/company names, role, start date and offer terms, keeps letter versions and response events, and returns a private link once for HR to share manually. Rotating a link invalidates the previous link; unanswered offers can be revoked. Links expire after 1–30 days. Candidate rejection revokes unanswered offers automatically.

Candidates use `/offer#token=…` without an account to view, print, accept or decline the frozen letter. Tokens are hashed, kept out of request URLs and removed from browser history. Responses require an explicit selection, typed name and confirmation and are recorded once under a transaction. This is a response from the private link holder, not an identity-verified signature. Issuing or answering a letter sends no email and creates no employee or account. Once a candidate has offers, Hired requires the latest offer to be accepted against the current approved hiring evidence. Existing hires and flows without issued offers are preserved.

Company backups include frozen offers and events but exclude candidate link credentials. Operator recovery invalidates all recovered offer links while preserving letters and responses. After recovery, administrators can replace links for unexpired unanswered offers.

Under **Interview scorecards**, administrators can manage unanswered hiring requests: withdraw with a reason, or reassign to another active company manager/administrator who is separate from the requester, current approver and acting administrator. Closed requests retain their original requester, approver, frozen evidence, request note and decision fields; closure history records who acted, why, when, and the replacement request. The previous approver immediately loses access to the closed request and cannot submit a decision. Completed decisions cannot be withdrawn or reassigned.

Reassignment copies the original frozen evidence exactly and sends an in-app notice to the replacement approver. Stale evidence remains stale: withdraw and request a fresh review when candidate/job/interview details have changed. Closing a newer request never revives an older approval for Offer, Hired, or offer issuance. Closure history is included in company backups. Existing accounts, pending requests and completed decisions are preserved by an additive, repeatable migration.
