# PeopleOS HRIS

A working HR suite built with Next.js, React, TypeScript, and local SQLite. It includes company signup and isolation, staff imports, Nigeria 2026 payroll and payslips with reviewed period adjustments, attendance, documents, recruiting, goals/reviews/360 feedback, learning, onboarding, letters, notifications, analytics, and a company policy assistant. Existing employee, leave, manager approval, invitation, password, and recovery workflows are preserved. Core workflows and policy search run locally; generated AI answers require a configured AI Gateway account.

## HR operations and first payroll

Open **HR operations & self-service** from the existing workspace, or visit `/operations`. New companies register at `/signup` and follow **Company launch → Staff import → Payroll & payslips**. Download the CSV template and calculation review workbook inside the app. Employees use the same website on their phone for leave, clock-in/out, released payslips, learning, and notifications.

Read [HR suite workflows, payroll scope, external configuration, and acceptance evidence](docs/HR-SUITE.md). Payroll reference cases are **not accountant-approved**; the 100% accountant-agreement target still needs professional review. Payments currently provide bank export and recording of payments made externally, rather than live money movement.

Read the [prioritized remaining launch checklist](docs/LAUNCH-CHECKLIST.md) for professional sign-off, hosting, backups, company acceptance and optional integrations.

Administrators can track human workflow observations in **HR operations → Staff pilot**, with preserved history and backup coverage. Payroll sign-off remains separate.

Prepared launch materials: [operating runbook and backup automation](docs/OPERATIONS.md), [staff pilot acceptance](docs/PILOT-ACCEPTANCE.md), and [accountant review/sign-off](docs/PAYROLL-SIGNOFF.md). Production activation and human approvals remain pending.

For the no-budget testing path and port 3000 troubleshooting, read [Private preview](docs/PRIVATE-PREVIEW.md). Run `npm run preview:check` in the actual Codespace before starting another server.

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

### Performance review cycles

HR can open **Performance reviews → Review cycles**, create a cycle with start and due dates, and assign a reviewer to up to 200 selected active employees at a time. A cycle has one review per employee; repeated assignments skip existing reviews without changing their reviewer or response. Each batch validates company membership and prevents self-review before saving any assignments. Invalid batches roll back completely.

Assigned reviewers use the existing review editor to write and submit responses. Drafts remain private to HR and the reviewer; only HR can publish them to employees. Published reviews remain final. Cycle counts refresh after review updates, and HR can close a cycle once every assigned review is published. Closed cycles reject further assignments. Standalone reviews remain available. Cycle metadata and assignment links are included in company archives and operator database backups.

HR can expand **Assignment progress** within each cycle to see employee/reviewer names, draft/submitted/published status, due dates, overdue flags, and the last reminder date. Overdue counts include only draft responses past their individual due date, using Africa/Lagos dates; submitted reviews await HR publication instead. Refresh review progress to fetch other reviewers' latest changes.

**Remind pending reviewers** sends an in-app notification for each draft review in an open cycle that has started. Both employee and reviewer must be active, and the reviewer must have an account in the company. Reminder text contains the review title, record ID and due date, without response content or ratings. Each review can receive one reminder per Lagos calendar day; persistent delivery keys prevent duplicates across clicks, concurrent requests and restarts. Delivery, reminder history and audit events commit together, and failures roll back the batch. Submitted/published reviews and closed/future cycles do not receive reminders. Sending is manual; no email or automatic schedule is enabled. Reminder history is included in company archives and operator backups.

Within **Assignment progress → Reassign reviewer**, HR can transfer a draft or submitted cycle review to a different active reviewer with an existing company account. A reason is required. The form checks that the assignment and response still match what HR loaded; refresh progress if someone has edited or reassigned the review. The new reviewer receives an in-app handoff notification, and former reviewers immediately lose reviewer access. HR access continues to follow account permissions.

Reassignment preserves the response, rating, status, due date, record ID, and existing reminder history. Each handoff stores an immutable snapshot plus the former/new reviewer, actor, timestamp, and reason. HR can inspect snapshots under **Reassignment history**. Submitted responses remain submitted, and published reviews and closed cycles cannot be reassigned. Reassignment history is included in encrypted company archives and operator backups. No account, password, or employee profile is changed.

Employees can acknowledge their own **published** performance reviews under **Performance reviews** after confirming that they have received and read the displayed review. Acknowledgment records receipt; it does not indicate agreement with the rating or outcome. Drafts and submitted responses cannot be acknowledged. HR, managers, and reviewers cannot acknowledge someone else's review.

A receipt stores the employee/account identity, timestamp, hash and exact snapshot of the published review. The review, rating, publication status and cycle status stay unchanged. Repeated and concurrent submissions return the original receipt without duplicating its audit event. A stale or mismatched review hash is rejected. HR and the assigned reviewer see receipt dates on authorized review cards; cycle progress also shows acknowledged and awaiting-acknowledgment totals. Employees can acknowledge after cycle closure, and dates display in Lagos time. Receipts and evidence are included in encrypted company archives and operator recovery backups. Existing accounts, profiles and earlier reviews are preserved.

HR can use **Remind unacknowledged employees** on open or closed cycles to send manual in-app receipt reminders for published reviews. Acknowledged reviews, drafts and submitted responses are excluded. Inactive employees and staff without accounts are reported as unavailable. Each review can receive one acknowledgment reminder per Lagos calendar day; its delivery, history and audit event commit atomically. Repeated/concurrent requests skip existing deliveries. Assignment progress shows the last reminder date and delivery count. Receipt reminders preserve reviews, ratings and cycle status, and their history is included in company/operator backups. No automatic schedule or email is enabled.

Closed cycles offer **Completion summaries → Save completion summary**. Each saved snapshot freezes assignment/reviewer names and IDs, publication and receipt status, acknowledgment percentages and outstanding follow-up availability/reminder dates. Empty cycles show no completion percentage. Summaries contain operational metadata without ratings, review responses, emails or credentials. HR can download a private JSON artifact with a SHA-256 content hash, creation time and creator ID. Repeating an unchanged snapshot reuses the original; later receipts or follow-up changes create a new version while earlier versions remain intact. Summaries are company-scoped, require HR access, preserve all review data, and survive company/operator backup recovery.

Employees can use **Review follow-up** on their own published review to ask HR a question, before or after acknowledgment and cycle closure. Each review supports one open request at a time. The question and its exact review snapshot are preserved; retry keys and an open-request constraint prevent accidental duplicates. Requests and HR responses are private to the employee and HR, including when another employee is the assigned reviewer.

HR can enter a final response with **Record response and resolve**. The employee receives an in-app notice and can read the response and resolution time. Final responses cannot be rewritten, and retrying a resolved request returns its original result rather than creating another request. Employees may submit a new question after resolution. Request/response text is limited to 4,000 characters. Notifications contain record references without question or resolution content. Cycle progress shows open request counts; published reviews, ratings, acknowledgments, frozen summaries, accounts and profiles remain unchanged. Questions, review evidence, HR responses and audit records survive company/operator backup recovery.

**Review follow-up inbox** gives HR a company-scoped list of employee review questions and final responses, with Open/Resolved/All, All owners/My assignments/Unassigned, search and overdue filters. Only HR administrators can open this inbox. Each open request can have an active company HR owner and an optional due date. Ownership coordinates HR work and does not grant additional access.

Owner/due-date changes require a reason and the current assignment version. Concurrent or stale changes are rejected, and assignment history preserves earlier owners, dates and reasons. Removing an owner's HR role or deactivating them flags the owner as unavailable; HR can reassign or clear ownership without modifying the employee question. Overdue means an open request's due date is before the current Lagos calendar day. Resolved requests retain their history and cannot be reassigned. HR can record the final employee-visible response directly from the inbox. Reviews, receipts, summaries and employee profiles remain intact; assignment history is included in company/operator backup recovery.

In the HR inbox, **Remind overdue HR owner** manually notifies the current active HR owner of an open request whose due date has passed in Lagos time. **Needs HR owner** filters open requests that are unassigned or whose owner is no longer an active company HR administrator. HR can enter a required reason and **Escalate to HR** to notify the current active HR administrators to arrange ownership. Escalation does not change ownership, due dates, permissions or the employee question.

Owner reminders and escalations each allow one delivery per request per Lagos calendar day, with persistent duplicate protection across concurrent requests and restarts. Actions validate the displayed assignment version and recheck the owner's current role, company membership and active status. Reminder/escalation evidence, recipient records, notification creation and audit events commit together; failures roll back all delivery. Resolved requests reject both actions. Historical reasons, timestamps and recipient counts appear under **Reminder and escalation history** and survive encrypted company/operator recovery backups. Notifications carry references only, without employee question or HR response text. No email or automatic schedule is enabled.

The HR follow-up inbox includes **Saved workload summaries**. Saving captures all company review follow-ups, regardless of current inbox filters, with open/resolved, overdue, unassigned, unavailable-owner, due-today and missing-due-date counts. The private JSON download includes per-owner workload counts, request references, employee/owner names, assignment/due-date metadata, resolution timestamps and reminder/escalation counts and timestamps. It excludes question text, HR response text, assignment/escalation reasons, review ratings and contents, email addresses and credentials.

Snapshots are dated using Africa/Lagos, include a SHA-256 content hash, and remain unchanged when ownership or resolution status changes. Repeating identical data on the same Lagos day reuses its original summary without another audit event. A later workload change or calendar day produces a new version. Empty inboxes produce zero totals and no owner buckets. Saving and its audit event commit atomically. Only company HR administrators may list or download snapshots; summaries preserve all existing records and survive encrypted company/operator backup recovery.

**Bulk owner assignment** in the HR inbox lets an administrator select up to 200 open requests within the current filters, choose an active company HR owner (or unassigned), set/clear the shared due date, and enter a required reason. **Preview bulk assignment** shows each employee/request, current owner/date and proposed owner/date without modifying any record. Changing filters clears the selection and preview; changing the plan requires a new preview.

**Save reviewed bulk assignment** validates the preview, current versions, request status and target owner's eligibility under a single transaction. Any stale/resolved/foreign request or save failure rolls back the complete batch, including notifications and history. Unchanged assignments are counted without rewriting their individual history. Successful batches preserve the reviewed plan, per-request assignment history, audit evidence and safe retry result; replaying the same completed batch returns its original result without duplicate changes. Existing questions, responses, reviews, receipts, accounts and snapshots are preserved. Completed batches are included in encrypted company/operator backup recovery.

**Completed bulk assignment history** in the HR inbox lists saved batches independently of the current request filters. HR can inspect each reviewed before/after plan, selected/changed/unchanged counts, saving administrator, creation time and batch reason. **Download batch** exports the original plan, canonical input, result, actor identity and preview hash with a SHA-256 checksum over the artifact payload. It excludes employee question fields, HR response fields, review contents, ratings, emails and credentials. Downloads and history are company-scoped and available only to HR administrators.

Later request resolution, owner/date changes or employee profile changes do not rewrite saved batch evidence. New batches freeze the administrator's display name when saved. Earlier batches retain their original actor ID with an unknown historical display name rather than backfilling a current profile name. Viewing/downloading history is read-only; safe retries create no duplicate batches or audit events. Batch evidence, including saved administrator names, survives encrypted company/operator backup recovery.
