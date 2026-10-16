# PeopleOS HR suite: built workflows and acceptance evidence

The application extends the original employee, leave, manager-approval, invitation, password and recovery flows. Existing records and accounts are preserved. The new entry point is **HR operations & self-service** at `/operations`; new companies register at `/signup`.

| Area | Working flow | Access |
| --- | --- | --- |
| Companies, accounts, roles | Company signup, isolated directory/departments, employee records, employee/manager role changes, deactivation with session/link revocation | Company admin; own profile remains employee-only |
| Staff import | CSV template → validation preview with row errors → atomic import of up to 1,000 staff and optional compensation | Company admin |
| Documents | Upload, list, download; company-wide or employee-private documents; admin deletion | Employee owns private files; HR can manage their company's files |
| Payroll | Compensation and exclusions → statutory settings + reviewed period inputs → 2026 monthly draft → per-person calculation → explicit review → approval and payslip release | Company admin; employees and managers see only their own released payslips |
| Payroll YTD | Reviewed source opening balances; opening + released totals; missing-month flags; frozen payslip YTD; reconciliation CSV | Admin records/imports; employee and manager see only their own YTD |
| External payroll review | Immutable stated-reviewer/evidence record on released payroll; calculation SHA-256 fingerprint | Company admin; reviewer identity is not verified |
| Payroll evidence | Editable Excel workbook; 15 fixed-month + 6 reviewed-period Decimal reference cases; JSON comparison reports differences in kobo | Review assets contain fictional examples only |
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
- Draft runs freeze the compensation inputs and statutory policy. Future starters are excluded. Mid-month starters receive each recurring earning component prorated by inclusive calendar days from their recorded start date, rounded separately. NHIS and recurring after-tax deductions remain fixed monthly amounts. Partial months require a supplied reviewed PAYE amount and review/calculation reference. To recalculate, discard the draft and create it again. Approved runs and payslip calculations are immutable. One run per company/month prevents duplicate payroll. Recording a payment does not initiate a bank transfer or statutory remittance.
- **Outside this version:** automated cumulative/YTD PAYE calculations, arrears, unpaid-absence adjustments, leaver proration and termination-specific tax, nonresident rules, foreign currency, automated statutory filings, and automated salary payouts. Do not represent these as supported or classify all possible accountant cases as passed.
- Period inputs support one-off bonuses, a pensionable bonus portion under the BHT policy, and one-off after-tax deductions. Under the gross pension policy all bonuses are pensionable; NHF follows the company basic/gross policy. A bonus requires explicit reviewed total PAYE, including an explicit zero with a note where applicable. The engine does not infer annual tax from a one-off bonus or claim to compute prior-employer/YTD reconciliation. Full-month ordinary pay retains its original calculation. A supplied PAYE override is also allowed for a full month with a review note.
- Period inputs are company-scoped and admin-only, audited, and locked while any run for that month exists. Discard a draft before editing; approved runs cannot be discarded or edited. Payslips snapshot salary, policy, proration, period adjustments and the PAYE method. Original v1 history remains unchanged.
- `public/payroll-review.xlsx` has editable inputs, calculation formulas, independent reference values, assumptions, and source links. The Period review sheet and `public/payroll-period-cases.json` add six independently calculated cases with supplied PAYE inputs; they verify proration, contributions and net pay, not the legal correctness of supplied tax. Both JSON files are accepted by the app's comparison form. Replacing a reference expectation with a one-kobo difference is tested to fail comparison.
- The 100% accountant-agreement target remains pending until an accountant reviews the rules and signs off on the reference cases. The app does not manufacture an accountant approval.

## Year-to-date balances and external review records

- **YTD reconciliation** at Payroll & payslips adds company-admin CSV export and an employee’s own YTD view. Select a 2026 cutoff month. Totals add imported opening balances to Approved/Paid payroll through that month; drafts are excluded. Paid status does not count a run twice. PAYE amounts are tax withheld, not evidence of remittance to a tax authority.
- **Opening balances** cover January through a stated January–November 2026 cutoff. Enter gross, PAYE withheld, pension, NHF, NHIS, other after-tax deductions and employer contributions in naira. The server derives net, total deductions and employer cost, rejects negative/over-precise inputs and deductions above gross, and requires a reviewer name, source calculation reference and explicit confirmation. This is an administrator’s recorded claim, not verified accountant identity.
- Record opening balances before the employee’s first payroll draft here. Any draft or released payroll item for that employee/year locks changes. Discarding all of that employee’s drafts unlocks edits only if no released payroll exists. Record, edit and clear actions retain append-only before/after events. Company admins see source references and events; employees and managers see only their own totals, with source references withheld.
- A payroll period cannot overlap an employee’s opening cutoff. New runs must follow chronological order: resolve earlier drafts before creating a later month, and do not backdate behind an existing later run. These checks preserve the meaning of frozen YTD snapshots. Existing history remains unchanged.
- New drafts snapshot prior opening/released totals, included prior run IDs, unrecorded periods and totals after the current payslip. Old payslips remain byte-for-byte intact. Unrecorded months are explicitly listed; the app does not infer zero income or complete prior-employer tax information.
- **External review record** is available on released (Approved/Paid) runs. An admin can record the external reviewer’s stated name, evidence reference and findings. One immutable record binds to a SHA-256 fingerprint of the frozen period, policy and item calculations. This records evidence after release; it does not authenticate an accountant, gate the existing release flow, approve the tax rules or change payslips. No review is inserted automatically.
- **Automatic cumulative PAYE remains unimplemented.** YTD totals now provide the evidence for that next calculation workflow. Bonuses/partial months still require reviewed PAYE, and ordinary full-month calculations remain unchanged. Opening balances do not automatically correct tax. The workbook’s YTD reconciliation sheet checks opening-plus-released arithmetic and exclusion of drafts without representing it as a statutory tax calculation.
- Run `python3 tests/payroll-ledger.py` for role/company boundaries, source-reference privacy, opening validation and lock/unlock, overlap prevention, chronology, draft exclusion, exact exports, immutable snapshots, fingerprint matching and restart persistence. This suite is also included in `npm test` and uses a disposable database.

## The 24-hour first-payroll journey

1. Create a company at `/signup`.
2. Download the staff CSV template, replace example rows, preview, fix errors, and import.
3. Open **Payroll & payslips**. Record reviewed opening balances before the first draft when migrating earlier-year payroll. Configure compensation for every active employee, or explicitly exclude people who are not on this payroll (including the administrator if appropriate).
4. Configure period bonuses/deductions and reviewed PAYE for partial months or bonuses. Review the workbook, contribution applicability, NHF basis, relief evidence, and accountant comparison results.
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

To regenerate the workbook, install Python `openpyxl` and run `python3 scripts/build-payroll-review.py`. The authoring check also recalculates it with LibreOffice and compares every cached output with the independent expected kobo values using `python3 tests/payroll-workbook.py`. No existing account or real staff data appears in the public review assets.
