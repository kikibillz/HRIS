"use client";
import { useEffect, useState } from "react";
import { modules } from "@/lib/modules";
import { api, type Context } from "./types";
import RecordsPanel from "./records-panel";
import ReviewFollowupInbox from "./review-followup-inbox";
import PayrollPanel from "./payroll-panel";
import OffersPanel from "./offers-panel";
import RecruitingHandoffPanel from "./recruiting-handoff-panel";
import RecruitingPanel from "./recruiting-panel";
import ReminderAutomationPanel from "./reminder-automation-panel";
import OnboardingProgressPanel from "./onboarding-progress-panel";
import OnboardingPanel from "./onboarding-panel";
import PilotPanel from "./pilot-panel";
import LaunchPanel from "./launch-panel";
import BackupsPanel from "./backups-panel";
import ToolsPanel from "./tools-panel";
const extras: Record<
  string,
  { title: string; description: string; admin?: boolean; manager?: boolean }
> = {
  pilot: {
    title: "Staff pilot",
    description:
      "Record workflow test results and preserve acceptance evidence.",
    admin: true,
  },
  "review-followup-inbox": {
    title: "Review follow-up inbox",
    description:
      "Coordinate employee questions, HR ownership, due dates and final responses.",
    admin: true,
  },
  offers: {
    title: "Offer letters",
    description: "Issue private candidate letters and track responses.",
    admin: true,
  },
  "recruiting-handoff": {
    title: "Candidate handoff",
    description:
      "Review employee records and optional onboarding for approved hires.",
    admin: true,
  },
  interviews: {
    title: "Interview scorecards",
    description: "Capture interview evidence and review hiring approvals.",
  },
  "reminder-automation": {
    title: "Reminder automation",
    description: "Schedule daily in-app reminders and monitor delivery.",
    admin: true,
  },
  "onboarding-progress": {
    title: "Onboarding progress",
    description: "Track starters and remind employees about overdue tasks.",
    manager: true,
  },
  onboarding: {
    title: "Onboarding templates",
    description: "Reuse starter checklists and assign dated tasks in bulk.",
    admin: true,
  },
  backups: {
    title: "Backups & recovery",
    description: "Protect company records and inspect recovery archives.",
    admin: true,
  },
  people: {
    title: "Employee records",
    description:
      "Maintain employment details, account roles, and active status.",
    admin: true,
  },
  start: {
    title: "Company launch",
    description: "Get your team ready for the first payroll.",
    admin: true,
  },
  import: {
    title: "Staff import",
    description: "Preview and validate your staff list before importing.",
    admin: true,
  },
  payroll: {
    title: "Payroll & payslips",
    description: "Review monthly pay, statutory deductions, and payslips.",
  },
  attendance: {
    title: "Attendance",
    description: "Clock in, clock out, and check attendance from any device.",
  },
  documents: {
    title: "Documents",
    description: "Secure company and employee document storage.",
  },
  notifications: {
    title: "Notifications",
    description: "Updates and reminders for your work.",
  },
  analytics: {
    title: "Reports & analytics",
    description:
      "Explore company headcount, payroll, recruiting, and people workflows.",
    admin: true,
  },
  audit: {
    title: "Audit log",
    description: "Inspect company, account, and leave activity.",
    admin: true,
  },
  assistant: {
    title: "Policy assistant",
    description: "Find answers in published company policies.",
  },
};
export default function Operations() {
  const [context, setContext] = useState<Context | null>(null),
    [tab, setTab] = useState(""),
    [error, setError] = useState(""),
    [mobile, setMobile] = useState(false);
  useEffect(() => {
    api("operations")
      .then((c) => {
        setContext(c);
        const requested = new URLSearchParams(window.location.search).get(
          "tab",
        );
        setTab(
          requested &&
            (Object.hasOwn(extras, requested) ||
              Object.hasOwn(modules, requested))
            ? requested
            : c.user.access === "admin"
              ? "start"
              : "attendance",
        );
      })
      .catch((e) => setError(e.message));
  }, []);
  if (!context)
    return (
      <div className="ops-loading">
        {error || "Loading your company workspace…"}
        <p>
          <a href="/login">Sign in</a>
        </p>
      </div>
    );
  const admin = context.user.access === "admin",
    meta = extras[tab] ?? modules[tab];
  if (!meta) return null;
  const nav = [
    "start",
    "pilot",
    "people",
    "import",
    "payroll",
    "attendance",
    "documents",
    "reminder-automation",
    "onboarding-progress",
    "onboarding",
    "tasks",
    "templates",
    "letters",
    "jobs",
    "applicants",
    "interviews",
    "offers",
    "recruiting-handoff",
    "goals",
    "reviews",
    "review-followup-inbox",
    "feedback",
    "courses",
    "enrollments",
    "policies",
    "assistant",
    "notifications",
    "analytics",
    "audit",
    "backups",
  ];
  const allowed =
    (!meta.admin || admin) &&
    (!("manager" in meta && meta.manager) ||
      context.user.access !== "employee");
  return (
    <div className="ops-shell">
      <aside className={mobile ? "ops-sidebar open" : "ops-sidebar"}>
        <a href="/" className="brand">
          people<span className="brand-light">os</span>
        </a>
        <div className="ops-company">
          <strong>{context.company.name}</strong>
          <small>
            {context.user.name} · {context.user.access}
          </small>
        </div>
        <a className="nav-item" href="/">
          Profile, employees &amp; leave ↗
        </a>
        <nav>
          {nav
            .filter((k) => {
              const item = extras[k] ?? modules[k];
              return (
                (!item.admin || admin) &&
                (!("manager" in item && item.manager) ||
                  context.user.access !== "employee")
              );
            })
            .map((k) => (
              <button
                key={k}
                className={tab === k ? "nav-item selected" : "nav-item"}
                onClick={() => {
                  setTab(k);
                  setMobile(false);
                  window.history.replaceState(null, "", `/operations?tab=${k}`);
                }}
              >
                {(extras[k] ?? modules[k]).title}
              </button>
            ))}
        </nav>
      </aside>
      <div className="ops-main">
        <header>
          <button
            className="secondary ops-menu"
            onClick={() => setMobile(!mobile)}
          >
            Menu
          </button>
          <span>{context.company.name}</span>
          <a href="/">Back to workspace</a>
        </header>
        <main>
          <div className="heading">
            <div>
              <p className="eyebrow">YOUR PEOPLE, CONNECTED</p>
              <h1>{meta.title}</h1>
              <p className="subtitle">{meta.description}</p>
            </div>
          </div>
          {!allowed ? (
            <p role="alert">
              {meta.admin
                ? "Administrator access required."
                : "Manager or administrator access required."}
            </p>
          ) : modules[tab] ? (
            <RecordsPanel key={tab} kind={tab} context={context} />
          ) : tab === "review-followup-inbox" ? (
            <ReviewFollowupInbox context={context} />
          ) : tab === "offers" ? (
            <OffersPanel />
          ) : tab === "recruiting-handoff" ? (
            <RecruitingHandoffPanel />
          ) : tab === "interviews" ? (
            <RecruitingPanel context={context} />
          ) : tab === "reminder-automation" ? (
            <ReminderAutomationPanel />
          ) : tab === "onboarding-progress" ? (
            <OnboardingProgressPanel />
          ) : tab === "onboarding" ? (
            <OnboardingPanel context={context} />
          ) : tab === "pilot" ? (
            <PilotPanel />
          ) : tab === "start" ? (
            <LaunchPanel />
          ) : tab === "backups" ? (
            <BackupsPanel />
          ) : tab === "payroll" ? (
            <PayrollPanel context={context} />
          ) : (
            <ToolsPanel key={tab} kind={tab} context={context} />
          )}
        </main>
      </div>
    </div>
  );
}
