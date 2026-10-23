# First hands-on pilot: fictional data only

This walkthrough helps you test the app without paid integrations. It does not approve real payroll or fill in a human acceptance result automatically. The CSV is a fictional convenience sample, not a recommended salary/contribution policy.

## 1. Open your private preview

In the Codespace terminal, from the HRIS repository, run `npm run preview:check`. If stopped, run `npm run preview`, or `HRIS_ALLOW_SETUP=1 npm run dev -- --port 3000` and leave the terminal open. Open **Ports → 3000 → Open in Browser**, keeping visibility Private. The chat coding workspace and your Codespace are separate machines.

Preserve local edits before pulling the latest main. Use [private preview troubleshooting](PRIVATE-PREVIEW.md) if the port still fails. Check GitHub usage/spending settings and stop the Codespace when finished; this guide does not guarantee unlimited free usage.

## 2. Use a separate fictional company

Use `/signup` to create a clearly named **Fictional Pilot Company** with a separate test administrator account and a password you choose. Keep your existing account and company intact; one login does not switch between multiple employers. Use a unique account email. Never publish passwords, account/invitation links or real staff data in Git or chat.

You may use reserved `.test` addresses for fictional staff. They cannot receive email; this app currently shares account setup/invitation links manually. If a test address is already used in this installation, choose another unique fictional address in the CSV before previewing. Do not overwrite existing people to reuse the sample.

## 3. Preview and import three fictional staff

Download [pilot-staff.csv](../public/pilot-staff.csv) (also linked in **HR operations → Staff pilot**). Open **Staff import**, select the file and preview it. Expect three rows, no validation errors, the Pilot Team department and the fictional job titles/salaries shown in the file. Commit only while signed into the fictional company. Re-previewing the same file after import should report duplicate/unavailable email addresses rather than overwrite people.

The file has no passwords, account permissions, bank details or real employee information. The `role` column is a job title, not administrator/manager access. Pension/NHF are set false solely for a simple fictional fixture; applicability for real staff needs professional review.

Record your actual result in **Staff pilot → Staff import**, supplying tester/role, the tested Git revision (`git rev-parse --short HEAD` in your terminal) and a brief evidence/issue note. Do not mark Passed unless you actually checked it.

## 4. Set up accounts and test leave approval

Use the existing **Employees → Account setup** controls to set up the imported users. Share invitation/setup links privately or choose test passwords through the app; no email delivery occurs. Under employee records, give Pilot Manager **manager account access** after account setup. Assign Pilot Employee One's leave approver to Pilot Manager using **Change approver**. Pilot Employee Two should stay an ordinary employee.

Use separate browser profiles/private windows so admin, manager and employee sessions do not replace each other. As Employee One, submit a valid leave request and note the dates. As Pilot Manager, review that request and approve or decline it with a reason. Return to Employee One and verify the status, reason and history. Check that Employee Two cannot decide Employee One's request or read HR-only records.

Record the outcomes under **Leave request and approval** and **Accounts and role privacy**. If a step fails, record Failed or Blocked with exact reproduction steps and the tested revision. Preserve earlier observations when retesting; the app appends history.

## 5. Optional fictional payslip privacy check

Stay in the fictional company. In **Company launch / Payroll & payslips**, review the imported fictional salary inputs and configure the fictional administrator's compensation or explicitly exclude that administrator from this test payroll. Choose a supported 2026 month and verify the selected policy and included people. Do not enter real bank/tax identifiers or record real payments.

Calculate a draft and inspect the fictional per-person amounts. Release a test run only after reviewing those test inputs through the app's controls; the released record is final in this fictional company. This test action is not accountant sign-off for real payroll. Sign in as Employee One and check that only their own released payslip appears, including on a phone-sized screen. Check the same own-payslip restriction as the manager and Employee Two. Record **Released payslip on mobile** and any relevant access findings. Leave professional payroll approval pending until a qualified reviewer signs off on the actual company scope.

If you are not ready to review even fictional payroll, leave this item Pending or Blocked and continue with leave, attendance or onboarding. Do not invent approval to complete a checklist.

## 6. Keep your findings

Use **Needs attention** and status/search filters to find unfinished checks. Record only completed human tests. Download the private JSON pilot report to keep/share manually with your reviewer; it includes saved notes and history, not unsaved edits or a launch authorization. Back up the fictional company if you want to retain the exercise. Git saves code, not the live database.

When requesting help, provide the failing step, role, expected/actual behavior and app revision, with a redacted screenshot or error where useful. Do not include passwords, invitation links or private employee documents. Use [the full pilot record](PILOT-ACCEPTANCE.md) for the remaining workflows.
