// Human-reported pilot results are independent of payroll approval and launch authorization.
export const pilotCases = [
  {
    id: "staff",
    title: "Staff import",
    expected:
      "Validate an import, confirm staff details and check duplicate protection.",
  },
  {
    id: "access",
    title: "Accounts and role privacy",
    expected:
      "Check sign-in, invitations, own documents/payslips and company isolation.",
  },
  {
    id: "leave",
    title: "Leave request and approval",
    expected:
      "Employee requests leave; assigned manager decides; history is preserved.",
  },
  {
    id: "attendance",
    title: "Attendance on mobile",
    expected: "Clock in/out once and read own attendance on a phone.",
  },
  {
    id: "onboarding",
    title: "Documents and onboarding",
    expected:
      "Check private documents, task owners/dates/completion and intended reminder recipients.",
  },
  {
    id: "recruiting",
    title: "Recruiting to employee",
    expected:
      "Review offer acceptance and a safe candidate-to-employee handoff.",
  },
  {
    id: "reviews",
    title: "Performance review cycle",
    expected:
      "Assign, submit, publish, acknowledge and resolve a private employee follow-up.",
  },
  {
    id: "inbox",
    title: "Saved HR inbox views",
    expected:
      "Save, pin, preview, archive and restore filters within the intended HR account.",
  },
  {
    id: "payroll",
    title: "Payroll comparison",
    expected:
      "Compare representative calculations with independent reviewed amounts. Recording a result is not accountant approval.",
  },
  {
    id: "payments",
    title: "External payment records",
    expected:
      "Check generic exports, actual-payment receipts, corrections and outstanding balances.",
  },
  {
    id: "payslip",
    title: "Released payslip on mobile",
    expected:
      "Employee reads only their own released payslip and calculation explanations.",
  },
  {
    id: "recovery",
    title: "Recovery rehearsal",
    expected:
      "Operator restores a separate copy and verifies accounts, documents and released payroll.",
  },
  {
    id: "operations",
    title: "Availability and support",
    expected:
      "Check host restart, private/HTTPS access, monitoring and who handles failures.",
  },
];
export const pilotStatuses = ["Pending", "Passed", "Failed", "Blocked"];
export const pilotRoles = [
  "HR",
  "Manager",
  "Employee",
  "Accountant/payroll specialist",
  "Operator",
];
