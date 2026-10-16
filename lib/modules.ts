export type Field = {
  key: string;
  label: string;
  type?:
    | "text"
    | "textarea"
    | "date"
    | "number"
    | "email"
    | "select"
    | "employee"
    | "reviewer"
    | "reference";
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
};
export type Module = {
  title: string;
  description: string;
  admin?: boolean;
  fields: Field[];
  statuses: string[];
};
const title: Field = { key: "title", label: "Title", required: true };
const body: Field = { key: "body", label: "Details", type: "textarea" };
const employee: Field = {
  key: "employee_id",
  label: "Employee",
  type: "employee",
  required: true,
};
const due: Field = { key: "due", label: "Due date", type: "date" };
export const modules: Record<string, Module> = {
  jobs: {
    title: "Job openings",
    description: "Create roles and manage vacancies.",
    admin: true,
    fields: [title, body, due],
    statuses: ["Open", "Paused", "Closed"],
  },
  applicants: {
    title: "Recruiting pipeline",
    description:
      "Track candidates from application to offer and hire. Offer and Hired transitions require current hiring approval in Interview scorecards.",
    admin: true,
    fields: [
      { ...title, label: "Candidate name" },
      { key: "email", label: "Candidate email", type: "email", required: true },
      {
        key: "reference_id",
        label: "Job opening",
        type: "reference",
        required: true,
      },
      body,
      due,
    ],
    statuses: [
      "Applied",
      "Screening",
      "Interview",
      "Offer",
      "Hired",
      "Rejected",
    ],
  },
  goals: {
    title: "Goals",
    description: "Track measurable employee goals and progress.",
    fields: [
      title,
      employee,
      body,
      due,
      {
        key: "progress",
        label: "Progress (%)",
        type: "number",
        min: 0,
        max: 100,
      },
    ],
    statuses: ["Open", "Completed", "Cancelled"],
  },
  reviews: {
    title: "Performance reviews",
    description:
      "Assign a reviewer, record a rating, and publish the review to the employee.",
    fields: [
      title,
      employee,
      {
        key: "reviewer_id",
        label: "Reviewer",
        type: "reviewer",
        required: true,
      },
      body,
      due,
      { key: "rating", label: "Rating (1–5)", type: "number", min: 1, max: 5 },
    ],
    statuses: ["Draft", "Submitted", "Published"],
  },
  feedback: {
    title: "360 feedback",
    description:
      "Request named feedback. Submitted feedback is visible to its subject and HR; responses are not anonymous.",
    fields: [
      title,
      employee,
      {
        key: "reviewer_id",
        label: "Feedback from",
        type: "reviewer",
        required: true,
      },
      body,
      { key: "rating", label: "Rating (1–5)", type: "number", min: 1, max: 5 },
      due,
    ],
    statuses: ["Requested", "Submitted"],
  },
  courses: {
    title: "Learning library",
    description:
      "Publish learning content, an optional knowledge check, and enroll employees.",
    fields: [
      title,
      body,
      { key: "url", label: "Learning URL (https)" },
      { key: "quiz_question", label: "Knowledge-check question" },
      { key: "quiz_answer", label: "Accepted answer (HR only)" },
    ],
    statuses: ["Published", "Archived"],
  },
  enrollments: {
    title: "My learning",
    description:
      "Track assignments, learning progress, and completion. Knowledge checks must pass before completion.",
    fields: [
      title,
      employee,
      {
        key: "reference_id",
        label: "Course",
        type: "reference",
        required: true,
      },
      body,
      { key: "quiz_answer", label: "Knowledge-check answer" },
      due,
    ],
    statuses: ["Assigned", "In progress", "Completed"],
  },
  tasks: {
    title: "Onboarding checklists",
    description: "Assign tasks, due dates, and owners for every new starter.",
    fields: [title, employee, body, due],
    statuses: ["Open", "Done"],
  },
  templates: {
    title: "Letter templates",
    description:
      "Use {{employee_name}}, {{role}}, {{start_date}}, and {{company_name}} to create employee letters.",
    admin: true,
    fields: [title, { ...body, required: true }],
    statuses: ["Active", "Archived"],
  },
  letters: {
    title: "Employee letters",
    description:
      "Issue a letter from a company template. Employees can read and print their own issued letters.",
    fields: [
      title,
      employee,
      {
        key: "reference_id",
        label: "Letter template",
        type: "reference",
        required: true,
      },
    ],
    statuses: ["Issued"],
  },
  policies: {
    title: "Company policies",
    description:
      "Publish the policies used by the policy assistant. Only published policies are available to employees.",
    fields: [title, { ...body, required: true }],
    statuses: ["Published", "Archived"],
  },
};
export const referenceKinds: Record<string, string> = {
  applicants: "jobs",
  enrollments: "courses",
  letters: "templates",
};
