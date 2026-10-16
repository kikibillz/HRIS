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
- Draft runs freeze the compensation inputs and statutory policy. Future starters are excluded. Mid-month starters receive each recurring earning component prorated by inclusive calendar days from their recorded start date, rounded separately. NHIS and recurring after-tax deductions remain fixed monthly amounts. Partial months require supplied reviewed PAYE or an explicitly selected cumulative calculation with complete history and evidence confirmation. To recalculate, discard the draft and create it again. Approved runs and payslip calculations are immutable. One run per company/month prevents duplicate payroll. Recording a payment does not initiate a bank transfer or statutory remittance.
- **Outside this version:** automatic tax refunds, arrears, unpaid-absence adjustments, leaver proration and termination-specific tax, nonresident rules, foreign currency, automated statutory filings, and automated salary payouts. Do not represent these as supported or classify all possible accountant cases as passed.
- Period inputs support one-off bonuses, a pensionable bonus portion under the BHT policy, and one-off after-tax deductions. Under the gross pension policy all bonuses are pensionable; NHF follows the company basic/gross policy. A bonus requires explicit reviewed total PAYE (including explicit zero with a note where applicable) or the cumulative mode described below. Bonuses are counted once in YTD earnings. Full-month ordinary pay retains its original calculation unless cumulative mode is explicitly selected. A supplied PAYE override is also allowed for a full month with a review note.
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
- **Cumulative PAYE is opt-in per employee/month.** YTD totals supply its prior history; opening balances alone do not change tax. Existing monthly/reviewed methods remain available and unchanged. See the method, eligibility checks and limits below. The workbook’s YTD reconciliation sheet remains an arithmetic check, with cumulative tax cases on a separate sheet.
- Run `python3 tests/payroll-ledger.py` for role/company boundaries, source-reference privacy, opening validation and lock/unlock, overlap prevention, chronology, draft exclusion, exact exports, immutable snapshots, fingerprint matching and restart persistence. This suite is also included in `npm test` and uses a disposable database.

## Cumulative PAYE method and safeguards

The [Joint Revenue Board PIT Guidelines 2026](https://irs.kg.gov.ng/JRB_2026_PIT_Guidelines_Final.pdf), sections 7–9, 13 and Appendix 1, describe cumulative records, eligible deductions, rent relief, non-periodic pay and the 2026 bands. **The calendar-month annualisation/apportionment formula implemented here is an explicit method assumption for accountant/tax-authority review; the guidance does not prescribe that formula verbatim. There are no accountant-approved reference cases yet.**

1. In **Period adjustments & partial-month PAYE**, choose **Cumulative YTD monthly basis** for the employee/month. Leave reviewed PAYE blank; the two methods are mutually exclusive.
2. Confirm complete prior income/tax history and eligible-contribution/remittance evidence, and enter a method/evidence reference. All calendar months from January through the previous month must be covered by reviewed opening balances or Approved/Paid payroll. The server rejects missing periods and does not infer zero income. A genuine first job later in the year can use an explicitly reviewed zero opening before its first draft. Existing incomplete history is preserved and must use reviewed PAYE.
3. Preview the calculation, save period inputs and create a draft. The draft recalculates from authoritative server compensation and prior records; client-supplied prior amounts are ignored by the operational preview. The JSON reference-case comparison endpoint accepts explicit fictional priors solely for comparison.
4. Inspect the draft calculation, then use the existing explicit release review. Preview is not approval and does not freeze or change earlier payroll.

For calendar month `m`, the method computes:

- YTD gross = prior opening/released gross + actual current earnings, including a bonus once and any calendar-day proration.
- Eligible YTD contributions = prior and current employee pension + NHF + NHIS, subject to the administrator’s evidence confirmation. Employer contributions and after-tax deductions do not reduce chargeable income.
- Annualised chargeable income = `max(0, (YTD gross - eligible YTD contributions) × 12 / m - eligible annual rent relief - other approved annual reliefs)`.
- Cumulative tax = 2026 marginal-band tax on that figure × `m / 12`, rounded once half-up to integer kobo. BigInt rational scaling avoids intermediate rounding of annualised income or prorated bands. Displayed annualised chargeable income is rounded for display only.
- Current PAYE = cumulative tax minus prior PAYE withheld. Thus earlier under-deductions can be recovered in this month. At December, the method reconciles to the annual tax on recorded actual income and deductions.

Minimum-wage exemption is not inferred from a small partial-month payment. Cumulative mode requires an explicit eligibility claim with supporting evidence. Conflicting gross/YTD/bonus inputs are rejected. Ordinary monthly mode retains its original treatment.

If prior PAYE exceeds cumulative liability, preview shows a possible refund and automatic drafting is blocked. If catch-up tax produces negative net, preview shows that amount and drafting is blocked. Use externally reviewed PAYE after resolving the refund/recovery treatment; the app neither refunds tax nor silently caps it. No automatic tax remittance or payout is performed.

Cumulative working (method version, calendar month, annualised chargeable income, cumulative tax, prior PAYE, current PAYE, reliefs, band scaling and reference) is frozen into each new cumulative payslip. Existing released records, review fingerprints, monthly settings, and account data are untouched.

`public/payroll-cumulative-cases.json` contains 11 independent Decimal engineering cases, accepted by the comparison form. The workbook’s **Cumulative PAYE** sheet uses editable Excel formulas checked after LibreOffice recalculation. Cases cover ordinary pay, bonuses, salary changes, partial-month first jobs, contributions/reliefs, annual reconciliation, top bands, rounding, minimum-wage eligibility and prior under-deduction. Additional tests cover a full year of rounding, history gaps, permission boundaries, contradictory methods, refund/negative-net blockers, authoritative server inputs and mobile release.

## The 24-hour first-payroll journey

1. Create a company at `/signup`.
2. Download the staff CSV template, replace example rows, preview, fix errors, and import.
3. Open **Payroll & payslips**. Record reviewed opening balances before the first draft when migrating earlier-year payroll. Configure compensation for every active employee, or explicitly exclude people who are not on this payroll (including the administrator if appropriate).
4. Configure period bonuses/deductions and reviewed PAYE or an explicitly selected cumulative method for partial months or bonuses. Review the workbook, contribution applicability, NHF basis, relief evidence, and accountant comparison results.
5. Calculate a 2026 monthly draft, inspect every calculation, confirm review, and release payslips.
6. Download the schedule for the specific approved run for the bank and authorities. The separate history export includes all approved periods. Record the actual bank payment reference after paying externally.
7. Invite staff through the existing employee account controls. Employees can use their phone browser for leave, attendance, payslips, documents, learning, and notifications.

Analytics measure elapsed hours from company creation to its first `Payroll approved` audit event. The 24-hour figure is a product target, not a guarantee of legal payroll accuracy. The browser acceptance test exercises the signup → import → payroll → mobile self-service journey using fictional data and a disposable database.

## Salary and statutory payment reconciliation

**Payment approach: bank exports and manual reconciliation, as selected by the workspace owner. No live salary-transfer provider is connected.**

- Released payroll has **Payments & statutory remittance reconciliation**. Admins can record partial or full salary receipts per employee and separate PAYE, employee + employer pension, NHF, NHIS, employer ECS/NSITF and ITF accrual receipts. Calculated amounts come from frozen payroll items, not edited compensation. Employer contributions remain employer costs.
- Recording requires an amount, actual payment date, unique receipt-allocation reference and confirmation that payment already occurred outside the app. Notes can reference the supporting bank/authority evidence. Dates must be valid and no later than today in Africa/Lagos. Positive exact-kobo amounts cannot exceed the outstanding balance. Drafts and foreign-company runs cannot receive receipts.
- References are unique per company across individual allocations; voided references remain reserved. A shared bank receipt must have a distinct allocation reference for each employee or obligation. Existing whole-batch salary references also cannot be reused. Database transactions serialize allocation/balance checks.
- Salary balance reaches zero only when active employee receipts cover frozen net pay (or an existing legacy batch record covers the run). A fully reconciled individual run becomes **Paid**. This status describes salary records; it does **not** assert that statutory obligations were remitted. Separate statutory balances remain visible. CSV exports show calculated, recorded-paid and outstanding integer-kobo amounts.
- An admin can correct an individual receipt with an explicit reason and confirmation. The correction appends a void record; original amount, reference, date, notes and actor remain in history. Voids reopen outstanding amounts and can return an individually settled run to **Approved**. They do not reverse/refund a bank transaction, alter payslip calculations, invalidate review fingerprints or change PAYE withheld/YTD totals.
- Existing `payments` batch records and paid history remain unchanged and are shown explicitly as legacy salary-batch evidence. The app prevents whole-batch recording once active individual salary receipts exist and prevents new salary receipts against an already fully recorded legacy batch. Legacy batch correction is not implemented; individual void controls apply only to new allocation records.
- All receipts, references, correction history and reconciliation exports are company-admin only. Employees/managers retain their own payslip access and salary-run status. Mutations are audited, use the existing same-origin checks and cannot transfer money. Supporting evidence and actual receipt by a bank, pension fund or authority are not verified by this manual workflow.
- ITF is a monthly payroll accrual toward an annual obligation. This reconciliation is not a statutory filing, eligibility determination or deadline calculator. Confirm applicability and actual remittance amounts externally.

## Configurable generic exports and statutory preparation packs

The selected export target is a **configurable generic bank schedule**. These formats are preparation aids, not certified bank/authority upload templates. Confirm the institution’s exact specification before using an export. No transfer, return submission or remittance occurs.

- Released runs have **Bank exports & statutory filing packs**, visible to company admins only. The bank schedule uses active recorded outstanding net pay, excluding fully reconciled or zero-net employees. Amounts use decimal NGN with exactly two digits; account numbers retain leading zeros in CSV bytes. Import identifier columns as text in spreadsheet tools.
- Company bank columns can be reordered/renamed with JSON mappings. Allowed sources are beneficiary, bank, bank_code, account_number, amount, currency, reference and narration. Beneficiary, account_number and amount are required. Unrecognised sources, duplicate/unsafe headers and invalid mappings are rejected. CSV formula-injection protection also covers whitespace-prefixed formulas.
- Bank readiness requires a bank name and 10-digit account number for each outstanding beneficiary. A template using bank_code additionally requires that code. A fully reconciled run cannot generate a new bank-payment schedule. Exporting does not reserve funds or detect payments not yet recorded; recheck bank activity and reconciliation before upload.
- Statutory packs include PAYE schedules with employee Tax ID and resident tax authority, pension/NHF/NHIS and employer contribution schedules, calculated-versus-recorded obligation totals, receipt/correction history, README and manifest. They show full frozen liabilities, with recorded payments separately, rather than silently filing only unpaid balances. ITF remains a monthly accrual toward an annual obligation.
- Nonzero obligations require the applicable employer reference. Nonzero employee PAYE requires Tax ID and resident tax authority; pension requires a pension identifier; NHF requires its identifier. These are presence/format checks and an administrator’s evidence review, not verification by an institution or a determination of legal residency/applicability.
- **Review export identifiers** stores run/employee-specific corrections with a source reference and explicit confirmation. Changes are company-scoped and audited with before/after values; approved salary/tax/payslip snapshots are untouched. This permits correcting payment/filing routing without recalculating approved payroll.
- **Generate immutable export pack** validates readiness again inside a database transaction and stores the files, column mapping, employer references, reviewed identifiers and reconciliation balances. ZIP downloads include a manifest with SHA-256 checksums. Existing packs remain byte-identical after later receipts, voids, profile edits or settings changes. Generation is audited and downloads enforce company-admin access. No existing pack can be overwritten through the API.
- Pack history is stored with SQLite. It contains sensitive payroll and bank data, so preserve and protect the database backups alongside the original accounts and documents. An export is a point-in-time preparation snapshot; it does not prove payment, filing acceptance or legal payroll accuracy.

## External configuration and present boundaries

- No salary payout provider, live transfer credentials, or remittance integration is connected. The selected approach is bank-file export plus manual salary/remittance receipt reconciliation.
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
