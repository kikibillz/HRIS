# PeopleOS: remaining launch work

Reviewed against the repository on 23 October 2026. This is a release checklist, not confirmation that a production installation or real payroll has been approved. Repository tests use disposable, fictional data; the Codespaces preview is separate from a production deployment.

## Built and available for acceptance testing

Company isolation, roles, staff imports, leave approvals, attendance, private documents, onboarding, learning, letters, in-app notifications, Nigeria 2026 payroll/payslips, YTD balances, bank export packs and manual payment reconciliation are implemented. Recruiting includes interview evidence, hiring approvals, immutable offer letters, candidate acceptance, approval withdrawal/reassignment, and candidate-to-employee handoff. Performance includes review cycles, bulk assignments, reviewer reassignment, publication, employee acknowledgments, HR follow-up questions/resolutions, ownership/due dates, reminders/escalations, workload snapshots, reviewed bulk handoffs, and private saved/pinned/archived inbox views.

Read [HR suite scope](HR-SUITE.md) for calculation and workflow limits. Passing software tests does not complete the external steps below.

## Before using live payroll or launching to staff

| Priority | Remaining work | Who completes it | Completion evidence |
| --- | --- | --- | --- |
| 1 | Review Nigeria 2026 PAYE, contribution bases, relief evidence, bonus/partial-month methods, and opening balances for the actual company. | Company HR/finance and a qualified accountant | Written sign-off on the rules and reference cases, plus reconciliation of representative company payroll. Engineering reference checks already exist; professional approval remains outstanding. |
| 2 | Choose and provision the production host, persistent storage, domain and HTTPS proxy. Run one SQLite writer using the documented production setup. | Deployment operator, with the owner's host/domain choices | Production URL loads, HTTPS origin/cookies behave correctly, readiness passes, and accounts/documents survive a restart and update. Docker/Compose support is implemented; this repository review does not verify a live host. |
| 3 | Arrange encrypted off-host backups, a schedule, retention and a responsible operator. Rehearse restoring to a separate directory before cutover. | Deployment operator | An off-host archive, a successful restore drill, and agreed acceptable data loss/recovery time. Backup/restore tools exist; automatic backup scheduling and retention are not implemented. |
| 4 | Run an acceptance pilot with HR, a manager and an employee on desktop and phone. Verify imported staff, reporting lines, access, offers, hiring, reviews, leave, documents and the first payroll. | Company HR and pilot users | Recorded acceptance results and resolved defects. Automated browser tests exist; company acceptance is still required. |
| 5 | Assign operating responsibilities: monitor health/storage and reminder delivery, handle failed jobs, approve releases, and document recovery ownership. Confirm staff-data access and retention decisions. | Company owner/HR and deployment operator | Named owners and a short operating runbook. Health endpoints, reminder delivery history and audit records exist; they do not provide an external alerting/on-call service. |

Use [production deployment](DEPLOYMENT.md) and [backup recovery](BACKUP-RECOVERY.md) for the concrete commands. Never replace the live database during a restore rehearsal.

The readiness endpoint now checks core storage plus the required performance/follow-up tables and recent columns, including batch actor names and pinned-view preferences. It stays read-only, returns a generic unavailable response for incomplete migrations, and never creates or repairs storage. Readiness does not certify payroll accuracy, available disk capacity, background-worker health, or every application feature.

## Optional scope decisions after the pilot

These are not blockers if the existing manual workflows meet the company's needs.

- **Email/SMS/push:** notifications are currently in-app; invitation, recovery and offer links are shared manually. External delivery needs a provider choice, configuration and delivery testing.
- **Generated policy answers:** policy search works now. Generated answers need AI Gateway configuration, a selected model, company allowlisting and live verification. AI is optional.
- **Bank and authority integrations:** generic export preparation and manual reconciliation are implemented. Institution-specific certified formats, direct salary transfers and automated statutory filings require separate specifications/integrations; they are not prerequisites for the chosen manual approach.
- **Additional payroll cases:** arrears, unpaid-absence adjustments, leaver/termination-specific treatment, automatic refunds, nonresident rules and foreign currency remain outside the current version. Decide which are needed before using the app for affected employees.
- **Larger product scope:** one login across multiple employers, SCORM/video hosting and multi-writer database scaling are not implemented. Prioritize them only when a real requirement appears.

## Recommended next order

Complete the accountant review and deployment/backup decisions first, run the company pilot, fix the pilot's issues, then schedule launch. Add optional integrations after agreeing their scope. More inbox convenience features are not a substitute for these launch steps.
