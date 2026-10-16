"use client";
import { useEffect, useState } from "react";
import { modules } from "@/lib/modules";
import { api, type Context } from "./types";
import RecordsPanel from "./records-panel";
import PayrollPanel from "./payroll-panel";
import OnboardingPanel from "./onboarding-panel";
import LaunchPanel from "./launch-panel";
import BackupsPanel from "./backups-panel";
import ToolsPanel from "./tools-panel";
const extras: Record<
  string,
  { title: string; description: string; admin?: boolean }
> = {
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
    "people",
    "import",
    "payroll",
    "attendance",
    "documents",
    "onboarding",
    "tasks",
    "templates",
    "letters",
    "jobs",
    "applicants",
    "goals",
    "reviews",
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
  const allowed = !meta.admin || admin;
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
            .filter((k) => !(extras[k] ?? modules[k]).admin || admin)
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
            <p role="alert">Administrator access required.</p>
          ) : modules[tab] ? (
            <RecordsPanel key={tab} kind={tab} context={context} />
          ) : tab === "onboarding" ? (
            <OnboardingPanel context={context} />
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
