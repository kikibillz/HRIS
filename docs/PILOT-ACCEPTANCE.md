# Staff pilot acceptance record

Status: **not yet accepted by company users**. Automated software tests are separate evidence. Start with fictional or approved test data in a private pilot environment; do not import real salaries before company/accountant review. Never place passwords, bank details or employee documents in this record.

The company administrator can record these observations under **HR operations → Staff pilot**. Each workflow stores Pending/Passed/Failed/Blocked, the reported tester and role, tested revision and evidence/issue notes. Updates append history, reject stale edits and are included in backups. Tester identities/qualifications and app revisions are stated by the recorder. These records do not create accountant approval or a launch authorization. Use private references instead of staff data in notes.

Record company/pilot environment, app Git revision, date/time (Africa/Lagos), HR lead, manager and employee testers, accountant reviewer, issue tracker and acceptance decision. All names and acceptance decisions are unassigned/pending until the real participants supply them.

| Journey | Expected result | Human result / evidence |
| --- | --- | --- |
| HR imports staff | Preview catches errors; committed people/departments/salaries match the approved import; repeating does not silently duplicate records | Pending |
| Accounts and roles | Existing users sign in; own-password/invitation flow works; employee cannot access HR payroll, another employee's documents or another company | Pending |
| Employee asks for leave | Assigned manager sees and decides; employee sees reason and preserved history; unrelated manager cannot decide | Pending |
| Attendance/mobile | Employee clocks in/out once, sees own history and can read pages without horizontal page overflow | Pending |
| Documents/onboarding | Private documents stay private; tasks retain owner/due/completion; reminders appear in the intended inbox and duplicate sends are prevented | Pending |
| Recruiting to employee | Approved candidate receives manually shared offer link; acceptance/decline is recorded; only eligible accepted candidates are handed off; existing employees are linked safely | Pending |
| Performance cycle | HR assigns reviewers; reviewer submits; HR publishes; employee reads/acknowledges and asks a private follow-up; HR ownership/response/history work | Pending |
| Saved HR inbox views | Filters save, pin, preview, archive and restore within the HR user's own account; selecting a preview does not apply filters | Pending |
| Reviewed first payroll | Approved staff/salary/relief/opening inputs match source evidence; accountant reconciles ordinary, partial-month and bonus examples; draft/release/payslip/YTD totals agree | Pending; requires accountant review |
| External payments | Generic bank export is validated with the actual bank; HR records only payments actually made; partial receipts/corrections leave correct outstanding balances | Pending |
| Released payslip/mobile | Employee sees only their own released payslip and explanations; manager cannot read other people's payslips | Pending |
| Recovery rehearsal | Operator restores an encrypted archive into separate storage; existing account/password, documents and released payroll are validated; original installation is retained | Pending on chosen host |
| Availability and support | Host restart preserves accounts/data; HTTPS/health/monitoring work; test backup failure is noticed by the named operator | Pending on chosen host |

For each issue record reproduction steps, expected/actual behavior, role, app revision, severity, owner and retest result. Reference private evidence rather than copying staff data into Git. Block launch on unresolved payroll, access-control, data-loss or core-workflow failures. HR approves workflow acceptance; the accountant approves calculation scope; the operator/recovery owner approves operational readiness. Passing an automated suite does not fill the human result column.
