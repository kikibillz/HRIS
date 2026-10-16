# PeopleOS HR suite: built workflows and acceptance evidence

The application extends the original employee, leave, manager-approval, invitation, password and recovery flows. Existing records and accounts are preserved. The new entry point is **HR operations & self-service** at `/operations`; new companies register at `/signup`.

| Area | Working flow | Access |
| --- | --- | --- |
| Companies, accounts, roles | Company signup, isolated directory/departments, employee records, employee/manager role changes, deactivation with session/link revocation | Company admin; own profile remains employee-only |
| Staff import | CSV template → validation preview with row errors → atomic import of up to 1,000 staff and optional compensation | Company admin |
| Documents | Upload, list, download; company-wide or employee-private documents; admin deletion | Employee owns private files; HR can manage their company's files |
| Payroll | Compensation and exclusions → statutory settings → fixed-monthly 2026 draft → per-person calculation → explicit review → approval and payslip release | Company admin; employees and managers see only their own released payslips |
| Payroll evidence | Editable Excel workbook; 15 independent Decimal reference cases; JSON comparison reports differences in kobo | Review assets contain fictional examples only |
| Payments and remittances | Approved payroll CSV, tax/pension/NHF identifiers, bank fields, external bank reference, Paid state, duplicate-payment protection | Company admin; this records payments made outside the app |
| Leave | Existing self-service requests, balances, pending cancellation, assigned-manager approvals, and history; now company-scoped with in-app notifications | Existing ownership and manager rules preserved |
| Attendance | Server-timestamp clock-in/out; one open shift per employee; attendance history | Own employee; direct-report manager; company admin |
| Recruiting | Vacancies and candidate records; Applied → Screening → Interview → Offer → Hired / Rejected; recorded status history | Company admin |
| Performance | Goals/progress; reviews assigned to a reviewer; draft → submitted → HR-published review | Employee owns goals; reviewer sees assigned drafts; subject sees published reviews |
| 360 feedback | Named requests and 1–5 ratings, final submission; no anonymous-feedback promise | Assigned reviewer, HR, and subject after submission |
| Learning | Published content/HTTPS course links; optional question and answer; self/HR enrollment, progress, checked completion | Employees see published learning, not stored quiz answers; own assignments |
| Onboarding | Employee task checklists, owners, dates, Open/Done status | Employee and direct-report manager; HR |
| Letters | Company templates with supported tokens → immutable employee letter → print/save PDF | HR issues; employee reads own letters |
| Notifications | Payroll release, leave events, assigned tasks/reviews, document availability, and manual HR messages; mark read | Employee sees their own notifications |
| Reports and analytics | Current headcount by department; hiring cohorts and stage distribution; payroll costs/PAYE; workflow completion counts; published review ratings; first-hire timing; closed attendance hours; first-payroll SLA | Company admin |
| Audit | Company mutation log; existing account-security and leave-decision histories; actor, target, time | Company admin |
| Policy assistant | Search published company policies, with source passages; generated, source-grounded answers through the AI SDK when configured | Signed-in company members; no private employee documents or payroll in AI context |

## Payroll review scope

**Country: Nigeria. Rule year: 2026. Status: engineering-reviewed test cases, not accountant-approved payroll.**

- The first release handles fixed recurring monthly employment earnings in NGN, with integer-kobo arithmetic and half-up rounding. It supports the 2026 progressive annual bands (0%, 15%, 18%, 21%, 23%, 25%), statutory minimum-wage exemption, pension, employee-selected/applicable NHF, configured NHIS amounts, eligible rent relief, additional approved annual reliefs, and other after-tax deductions.
- Pensionable emoluments can use basic + housing + transport or all gross earnings. Employee and employer rates are explicit. Pension applicability is per employee. Confirm contractual bases and any exemptions with the accountant.
- NHF applies only when selected for the employee. Both basic and gross calculation bases are available because official FMBN publications use different wording. The company must confirm which guidance applies before approving payroll.
- Employer ECS is a separate employer cost. ITF defaults to disabled; enable the applicable rate after confirming eligibility (ITF guidance describes employers with at least five employees or the applicable turnover threshold). The monthly ITF amount is an accrual toward an annual obligation, not an employee deduction or a claim that it was remitted.
- Relief inputs require supporting evidence and accountant review. Employee deductions cannot exceed gross pay. Excluded employees are explicitly recorded, rather than silently omitted because salary information is missing.
- Draft runs freeze the compensation inputs and statutory policy. Future starters are excluded; mid-month starters requiring proration are blocked rather than silently paid a full month. To recalculate, discard the draft and create it again. Approved runs and payslip calculations are immutable. One run per company/month prevents duplicate payroll. Recording a payment does not initiate a bank transfer or statutory remittance.
- **Outside this version:** variable earnings/bonuses, cumulative/YTD PAYE adjustments, arrears, proration, termination-specific tax, nonresident rules, foreign currency, automated statutory filings, and automated salary payouts. Do not represent these as supported or classify all possible accountant cases as passed.
- `public/payroll-review.xlsx` has editable inputs, calculation formulas, independent reference values, assumptions, and source links. `public/payroll-reference-cases.json` is accepted by the app's comparison form. Replacing a reference expectation with a one-kobo difference is tested to fail comparison.
- The 100% accountant-agreement target remains pending until an accountant reviews the rules and signs off on the reference cases. The app does not manufacture an accountant approval.

## The 24-hour first-payroll journey

1. Create a company at `/signup`.
2. Download the staff CSV template, replace example rows, preview, fix errors, and import.
3. Open **Payroll & payslips**. Configure compensation for every active employee, or explicitly exclude people who are not on this payroll (including the administrator if appropriate).
4. Review the workbook, contribution applicability, NHF basis, relief evidence, and accountant comparison results.
5. Calculate a 2026 monthly draft, inspect every calculation, confirm review, and release payslips.
6. Download the schedule for the specific approved run for the bank and authorities. The separate history export includes all approved periods. Record the actual bank payment reference after paying externally.
7. Invite staff through the existing employee account controls. Employees can use their phone browser for leave, attendance, payslips, documents, learning, and notifications.

Analytics measure elapsed hours from company creation to its first `Payroll approved` audit event. The 24-hour figure is a product target, not a guarantee of legal payroll accuracy. The browser acceptance test exercises the signup → import → payroll → mobile self-service journey using fictional data and a disposable database.

## External configuration and present boundaries

- No salary payout provider, live transfer credentials, or remittance integration is connected. Bank-file export and external-payment recording work now.
- Set `AI_GATEWAY_API_KEY`, `AI_GATEWAY_MODEL`, and `AI_ENABLED_COMPANY_IDS` on the server to enable generated policy answers for explicitly allowed companies. New public signups are not automatically allowed to spend the server’s model credits. Select an available model from the AI Gateway catalog. Without those settings, the assistant returns matching published passages and labels the result **Policy search**; it does not pretend an AI model ran. Live model behavior has not been verified without credentials. Generated answers are limited to 20 per account per hour and 600 output tokens per request.
- Notifications are in-app. No email, SMS, or push delivery is configured. Existing invitation/recovery links are still shared privately.
- Documents are stored with the SQLite database, up to 5 MB per file and 50 MB per company. File downloads enforce authorization and attachment-only delivery. Preserve `HRIS_DATA_DIR` and the database to retain documents alongside accounts and HR records.
- Peer selectors expose only coworker names and IDs for review/feedback assignment; employee profile and payroll data remain scoped to the signed-in employee.
- Account email addresses remain globally unique to preserve the existing account model. One account belongs to one company. Switching a single login between multiple employers is not implemented.
- Reviews are named; feedback subjects see submitted responses. Published reviews and completed learning records are final. The LMS supports content, external learning links, and one optional knowledge check per course; it does not provide SCORM/video hosting.
- Analytics label their grains and limitations: headcount/stages are current snapshots; attendance covers the latest 31 recorded days and closed shifts only; ratings use published reviews; time-to-hire excludes candidates without a recorded hire event. No synthetic company metrics are inserted.

## Verification commands

```sh
npm ci
npm run build
npm run typecheck
npm test
python3 tests/browser.py
python3 tests/accounts-browser.py
python3 tests/platform-browser.py
```

All HTTP and browser tests use disposable databases, never your working database. Browser tests require Python Playwright and Chromium. `npm test` covers original migrations, account/leave regression tests, independent payroll reference calculations, and the two-company HR-suite API journey.

To regenerate the workbook, install Python `openpyxl` and run `python3 scripts/build-payroll-review.py`. The authoring check also recalculates it with LibreOffice and compares every cached output with the independent expected kobo values. No existing account or real staff data appears in the public review assets.
