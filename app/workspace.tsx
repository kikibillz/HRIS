"use client";
import { useState } from "react";
import { workdays, validDate } from "@/lib/leave-policy";
import type { User } from "@/lib/auth";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Building2,
  CalendarDays,
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Check,
  X,
  ChevronDown,
  Leaf,
  Menu,
} from "lucide-react";
type Employee = {
  id: number;
  name: string;
  email: string;
  role: string;
  department: string;
  department_id: number;
  joined: string;
  status: string;
};
type Department = { id: number; name: string; count: number };
type Leave = {
  id: number;
  name: string;
  role: string;
  employee_id: number;
  type: string;
  start: string;
  end: string;
  status: string;
  reason: string;
};
type Balance = {
  type: string;
  total: number;
  used: number;
  reserved: number;
  available: number;
  year: number;
};
type Event = {
  id: number;
  leave_id: number;
  actor: string;
  action: string;
  note: string;
  created: string;
};
const initials = (name: string) =>
  name
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("");
export default function Workspace({
  data,
}: {
  data: {
    employees: Employee[];
    departments: Department[];
    leaves: Leave[];
    user: User;
    balances: Balance[];
    events: Event[];
  };
}) {
  const router = useRouter();
  const [tab, setTab] = useState(data.user.access === "employee" ? "My profile" : "Overview");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobile, setMobile] = useState(false);
  const isEmployee = data.user.access === "employee";
  const profile = data.employees.find((e) => e.id === data.user.employee_id);
  const isAdmin = data.user.access === "admin";
  const canReview = data.user.access !== "employee";
  const [decision, setDecision] = useState<{
    id: number;
    status: string;
  } | null>(null);
  const [dates, setDates] = useState({ start: "", end: "" });
  const [leaveType, setLeaveType] = useState("Annual leave");
  const [balanceYear, setBalanceYear] = useState(new Date().getUTCFullYear());
  const pending = data.leaves.filter((l) => l.status === "Pending");
  const today = new Date().toISOString().slice(0, 10);
  const away = new Set(
    data.leaves
      .filter(
        (l) => l.status === "Approved" && l.start <= today && l.end >= today,
      )
      .map((l) => l.employee_id),
  ).size;
  async function mutate(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/" + path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw Error(result.error);
      setModal("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  function open(kind: string) {
    setError("");
    setDates({ start: "", end: "" });
    setModal(kind);
  }
  function review(id: number, status: string) {
    setError("");
    setDecision({ id, status });
    setModal("decision");
  }
  const selectedLeave = data.leaves.find((l) => l.id === decision?.id);
  const reviewable = (l: Leave) =>
    canReview && l.employee_id !== data.user.employee_id;
  const decisionButtons = (l: Leave) => (
    <div className="decision-buttons">
      {reviewable(l) ? (
        <>
          <button
            disabled={busy}
            aria-label={"Approve " + l.name}
            onClick={() => review(l.id, "Approved")}
          >
            <Check size={17} />
          </button>
          <button
            disabled={busy}
            aria-label={"Decline " + l.name}
            onClick={() => review(l.id, "Declined")}
          >
            <X size={17} />
          </button>
        </>
      ) : l.employee_id === data.user.employee_id ? (
        <button disabled={busy} onClick={() => review(l.id, "Cancelled")}>
          Cancel request
        </button>
      ) : (
        <small>Awaiting review</small>
      )}
    </div>
  );
  const employees = data.employees.filter((e) =>
    `${e.name} ${e.email} ${e.department} ${e.role}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  function directory(compact = false) {
    const rows = compact ? employees.slice(0, 5) : employees;
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Job title</th>
              <th>Department</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td>
                  <div className="person">
                    <span className={"avatar color" + (e.id % 4)}>
                      {initials(e.name)}
                    </span>
                    <span>
                      <strong>{e.name}</strong>
                      <small>{e.email}</small>
                    </span>
                  </div>
                </td>
                <td>{e.role}</td>
                <td>
                  <span className="dept-tag">{e.department}</span>
                </td>
                <td>
                  <span className="status">
                    <i />
                    {e.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="empty">No employees match your search.</p>
        )}
      </div>
    );
  }
  return (
    <div className="shell">
      <aside className={mobile ? "sidebar mobile-open" : "sidebar"}>
        <a className="brand" href="/" aria-label="PeopleOS home">
          <span className="brand-icon">
            <Leaf size={23} />
          </span>
          people<span className="brand-light">os</span>
          <span className="brand-dot">•</span>
        </a>
        <div className="workspace-switch">
          <span className="company-icon">P</span>
          <div>
            <strong>People workspace</strong>
            <small>HR management</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {(isEmployee ? [
            { name: "My profile", icon: Users },
            { name: "Leave requests", icon: CalendarDays },
          ] : [
            { name: "Overview", icon: LayoutDashboard },
            { name: "Employees", icon: Users },
            { name: "Departments", icon: Building2 },
            { name: "Leave requests", icon: CalendarDays },
          ]).map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={tab === name ? "nav-item selected" : "nav-item"}
              onClick={() => {
                setTab(name);
                setSearch("");
                setMobile(false);
              }}
            >
              <Icon size={19} />
              {name}
              {name === "Leave requests" && pending.length > 0 && (
                <span className="nav-count">{pending.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <span>✦ A little more human.</span>
            <p>A happy team starts with a little care.</p>
            <Leaf size={30} />
          </div>
          <div className="profile">
            <span className="avatar admin">{initials(data.user.name)}</span>
            <div>
              <strong>{data.user.name}</strong>
              <small>{data.user.access} workspace</small>
            </div>
            <span className="online" />
          </div>
        </div>
      </aside>
      <div className="main">
        <header>
          <button
            className="menu-button"
            onClick={() => setMobile(!mobile)}
            aria-label="Toggle navigation"
          >
            <Menu size={20} />
          </button>
          <span>
            Workspace <span className="breadcrumb">/</span>{" "}
            <strong>{tab}</strong>
          </span>
          <div className="header-right">
            <button
              className="text-button"
              onClick={async () => {
                try {
                  const r = await fetch("/api/auth", { method: "DELETE" });
                  if (!r.ok) throw Error();
                  window.location.assign("/login");
                } catch {
                  setError("Unable to sign out. Try again.");
                }
              }}
            >
              Sign out
            </button>
            <span className="demo-badge">Prototype</span>
            <span className="avatar admin small-avatar">{initials(data.user.name)}</span>
          </div>
        </header>
        <main>
          <div className="heading">
            <div>
              <p className="eyebrow">{isEmployee ? "YOUR EMPLOYEE WORKSPACE" : "YOUR PEOPLE, CONNECTED"}</p>
              <h1>
                {tab === "Overview"
                  ? "A good day starts with your people."
                  : tab}
              </h1>
              <p className="subtitle">
                {tab === "My profile"
                  ? "Your employment details. Contact your administrator to request a correction."
                  : tab === "Overview"
                  ? "Here’s what’s happening across your team today."
                  : tab === "Employees"
                    ? "Meet the people who make it all happen."
                    : tab === "Departments"
                      ? "Great teams, working together."
                      : "A little time away goes a long way."}
              </p>
            </div>
            <button
              className="primary"
              onClick={() =>
                open(
                  !isAdmin || tab === "Leave requests"
                    ? "leave"
                    : tab === "Departments"
                      ? "department"
                      : "employee",
                )
              }
            >
              <Plus size={17} />
              {!isAdmin || tab === "Leave requests"
                ? "Request leave"
                : tab === "Departments"
                  ? "Add department"
                  : "Add employee"}
            </button>
          </div>
          {error && !modal && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {tab === "My profile" && profile && (
            <section className="panel">
              <div className="section-head"><h2>My profile</h2></div>
              <dl className="profile-details">
                {Object.entries({
                  Name: profile.name, Email: profile.email,
                  "Job title": profile.role, Department: profile.department,
                  "Joined on": profile.joined, Status: profile.status,
                }).map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
              <button className="secondary" onClick={() => setTab("Leave requests")}>
                View my balances and requests <ArrowRight size={16} />
              </button>
            </section>
          )}
          {tab === "Overview" && (
            <>
              <div className="stats">
                {[
                  {
                    label: "Total employees",
                    value: data.employees.length,
                    note: "People making things happen",
                    icon: Users,
                  },
                  {
                    label: "Departments",
                    value: data.departments.length,
                    note: "Connected by a shared purpose",
                    icon: Building2,
                  },
                  {
                    label: "On leave today",
                    value: away,
                    note: "Taking a well-deserved break",
                    icon: CalendarDays,
                  },
                  {
                    label: "Pending requests",
                    value: pending.length,
                    note: "Waiting for your review",
                    icon: Leaf,
                  },
                ].map(({ label, value, note, icon: Icon }) => (
                  <section className="stat" key={label}>
                    <div className="stat-top">
                      {label}
                      <Icon size={19} />
                    </div>
                    <strong>{String(value).padStart(2, "0")}</strong>
                    <p>{note}</p>
                  </section>
                ))}
              </div>
              <div className="middle-grid">
                <section className="welcome">
                  <div className="welcome-text">
                    <span className="pill">MADE FOR YOUR PEOPLE</span>
                    <h2>
                      Less paperwork.
                      <br />
                      More people work.
                    </h2>
                    <p>
                      Keep your team connected and give every
                      <br className="desktop-break" /> employee a place to
                      thrive.
                    </p>
                    <button onClick={() => setTab("Employees")}>
                      Explore your team <ArrowUpRight size={17} />
                    </button>
                  </div>
                  <div className="art" aria-hidden="true">
                    <div className="art-circle" />
                    <div className="floating-card top-card">
                      <span className="tiny-avatar">✦</span>
                      <div>
                        Growing together
                        <small>One team. Endless possibility.</small>
                      </div>
                    </div>
                    <div className="plant">
                      <span />
                      <span />
                      <span />
                      <span />
                      <div className="stem" />
                      <div className="pot" />
                    </div>
                    <div className="floating-card bottom-card">
                      <span className="tiny-avatar green">
                        <Check size={15} />
                      </span>
                      People first. Always.
                    </div>
                  </div>
                </section>
                <section className="panel leave-panel">
                  <div className="section-head">
                    <h2>
                      Time off requests <span>{pending.length}</span>
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => setTab("Leave requests")}
                    >
                      View all <ArrowRight size={15} />
                    </button>
                  </div>
                  {pending.slice(0, 2).map((l) => (
                    <div className="leave-item" key={l.id}>
                      <div className="person">
                        <span className={"avatar color" + (l.employee_id % 4)}>
                          {initials(l.name)}
                        </span>
                        <div>
                          <strong>{l.name}</strong>
                          <small>
                            {l.type} · {l.start.slice(5)} → {l.end.slice(5)}
                          </small>
                        </div>
                      </div>
                      {decisionButtons(l)}
                    </div>
                  ))}
                  {!pending.length && (
                    <p className="empty">
                      You’re all caught up. No pending requests.
                    </p>
                  )}
                  <div className="leave-footer">
                    <span className="status">
                      <i />
                    </span>
                    A little rest, a happier team.
                  </div>
                </section>
              </div>
            </>
          )}
          {(tab === "Overview" || tab === "Employees") && (
            <section className="panel directory">
              <div className="section-head">
                <div className="title-inline">
                  <h2>
                    {tab === "Overview" ? "Your people" : "Employee directory"}
                  </h2>
                  <span className="count">
                    {data.employees.length} employees
                  </span>
                </div>
                {tab === "Overview" ? (
                  <button
                    className="text-button"
                    onClick={() => setTab("Employees")}
                  >
                    View directory <ArrowRight size={15} />
                  </button>
                ) : (
                  <label className="search">
                    <Search size={16} />
                    <input
                      aria-label="Search employees"
                      placeholder="Search your people…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                )}
              </div>
              {directory(tab === "Overview")}
            </section>
          )}
          {tab === "Departments" && (
            <div className="department-grid">
              {data.departments.map((d) => (
                <section className="panel department-card" key={d.id}>
                  <span className="department-icon">
                    <Building2 size={24} />
                  </span>
                  <h2>{d.name}</h2>
                  <p>
                    {d.count} {d.count === 1 ? "employee" : "employees"}
                  </p>
                  <button
                    className="text-button"
                    onClick={() => {
                      setTab("Employees");
                      setSearch(d.name);
                    }}
                  >
                    Meet the team <ArrowRight size={16} />
                  </button>
                </section>
              ))}
            </div>
          )}
          {tab === "Leave requests" && (
            <>
              <section className="panel balance-panel">
                <div className="section-head">
                  <h2>My leave balance</h2>
                  <select
                    aria-label="Balance year"
                    value={balanceYear}
                    onChange={(e) => setBalanceYear(Number(e.target.value))}
                  >
                    {Array.from(new Set(data.balances.map((b) => b.year))).map(
                      (y) => (
                        <option key={y}>{y}</option>
                      ),
                    )}
                  </select>
                </div>
                <div className="balance-grid">
                  {data.balances
                    .filter((b) => b.year === balanceYear)
                    .map((b) => (
                      <div key={b.type}>
                        <small>{b.type}</small>
                        <strong>
                          {b.available} <span>days available</span>
                        </strong>
                        <p>
                          {b.total} allowance · {b.used} approved · {b.reserved}{" "}
                          pending
                        </p>
                      </div>
                    ))}
                </div>
                <p className="policy-note">
                  Prototype policy: calendar-year allowances; Monday–Friday
                  only. Pending requests reserve days. Public holidays and
                  carry-over are not yet supported.
                </p>
              </section>
              <section className="panel">
                <div className="section-head">
                  <h2>
                    {canReview ? "Team leave requests" : "My leave requests"}
                  </h2>
                  <span className="count">{pending.length} pending</span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Leave type</th>
                        <th>Dates</th>
                        <th>Status</th>
                        <th>{canReview ? "Review" : "Action"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.leaves.map((l) => (
                        <tr key={l.id}>
                          <td>
                            <div className="person">
                              <span
                                className={"avatar color" + (l.employee_id % 4)}
                              >
                                {initials(l.name)}
                              </span>
                              <strong>{l.name}</strong>
                            </div>
                          </td>
                          <td>{l.type}</td>
                          <td>
                            {l.start} → {l.end}
                          </td>
                          <td>
                            <span
                              className={
                                "leave-status " + l.status.toLowerCase()
                              }
                            >
                              {l.status}
                            </span>
                          </td>
                          <td>
                            {l.status === "Pending"
                              ? decisionButtons(l)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.leaves.length && (
                    <p className="empty">No leave requests yet.</p>
                  )}
                </div>
              </section>
              <section className="panel history-panel">
                {!data.leaves.length && <p className="empty">Your request history will appear here after you submit leave.</p>}
                <div className="section-head">
                  <h2>Request history</h2>
                </div>
                {data.leaves.map((l) => (
                  <details className="history-item" key={l.id}>
                    <summary>
                      {l.name} · {l.type} · {l.start} → {l.end}{" "}
                      <span
                        className={"leave-status " + l.status.toLowerCase()}
                      >
                        {l.status}
                      </span>
                    </summary>
                    <p>
                      <strong>Request reason:</strong> {l.reason}
                    </p>
                    <p>{workdays(l.start, l.end)} working days</p>
                    {data.events
                      .filter((v) => v.leave_id === l.id)
                      .map((v) => (
                        <p key={v.id}>
                          <strong>{v.action}</strong> by {v.actor} ·{" "}
                          {new Date(v.created).toLocaleString("en-GB", {
                            timeZone: "Africa/Lagos",
                          })}{" "}
                          WAT{v.note && <> — {v.note}</>}
                        </p>
                      ))}
                    {!data.events.some((v) => v.leave_id === l.id) && (
                      <small>
                        Imported from the initial prototype; no earlier review
                        history was recorded.
                      </small>
                    )}
                  </details>
                ))}
              </section>
            </>
          )}
          <footer>
            <span>Thoughtfully built for the people behind the work.</span>
            <span>
              <span className="footer-dot" /> PeopleOS workspace
            </span>
          </footer>
        </main>
      </div>
      {modal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal("");
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="section-head">
              <h2 id="modal-title">
                {modal === "decision"
                  ? decision?.status === "Cancelled"
                    ? "Cancel request"
                    : decision?.status === "Approved"
                      ? "Approve request"
                      : "Decline request"
                  : modal === "employee"
                    ? "Welcome someone new"
                    : modal === "department"
                      ? "Create a department"
                      : "Request time off"}
              </h2>
              <button
                className="icon-button"
                disabled={busy}
                onClick={() => setModal("")}
                aria-label="Close dialog"
              >
                <X size={21} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const b = Object.fromEntries(new FormData(e.currentTarget));
                if (modal === "decision")
                  mutate("leaves", { ...decision, note: b.note }, "PATCH");
                else
                  mutate(
                    modal === "employee"
                      ? "employees"
                      : modal === "department"
                        ? "departments"
                        : "leaves",
                    b,
                  );
              }}
            >
              {modal === "decision" && selectedLeave && (
                <div className="decision-summary">
                  <strong>
                    {selectedLeave.name} · {selectedLeave.type}
                  </strong>
                  <p>
                    {selectedLeave.start} → {selectedLeave.end} ·{" "}
                    {workdays(selectedLeave.start, selectedLeave.end)} working
                    days
                  </p>
                  <p>{selectedLeave.reason}</p>
                </div>
              )}
              {modal === "decision" ? (
                <label>
                  {decision?.status === "Declined"
                    ? "Why are you declining?"
                    : "Note (optional)"}
                  <textarea
                    name="note"
                    required={decision?.status === "Declined"}
                    maxLength={1000}
                  />
                </label>
              ) : modal === "employee" ? (
                <>
                  <label>
                    Full name
                    <input
                      autoFocus
                      required
                      name="name"
                      placeholder="e.g. Alex Morgan"
                      maxLength={120}
                    />
                  </label>
                  <label>
                    Work email
                    <input
                      required
                      type="email"
                      name="email"
                      placeholder="alex@company.com"
                    />
                  </label>
                  <label>
                    Job title
                    <input
                      required
                      name="role"
                      placeholder="e.g. Product Designer"
                      maxLength={120}
                    />
                  </label>
                  <label>
                    Department
                    <select name="department_id" required>
                      {data.departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Workspace access
                    <select name="access">
                      <option value="employee">
                        Employee — request own leave
                      </option>
                      <option value="manager">
                        Manager — review other employees’ leave
                      </option>
                    </select>
                  </label>
                  <label>
                    Initial password
                    <input
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={12}
                      maxLength={128}
                    />
                    <small>
                      At least 12 characters. Share privately with the employee.
                    </small>
                  </label>
                </>
              ) : modal === "department" ? (
                <label>
                  Department name
                  <input
                    autoFocus
                    required
                    name="name"
                    placeholder="e.g. Customer Success"
                    maxLength={100}
                  />
                </label>
              ) : (
                <>
                  {isAdmin ? (
                    <label>
                      Employee
                      <select
                        defaultValue={data.user.employee_id}
                        required
                        name="employee_id"
                      >
                        {data.employees.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p>
                      Requesting for <strong>{data.user.name}</strong>
                    </p>
                  )}
                  <label>
                    Leave type
                    <select
                      name="type"
                      value={leaveType}
                      onChange={(e) => setLeaveType(e.target.value)}
                    >
                      <option>Annual leave</option>
                      <option>Sick leave</option>
                      <option>Personal leave</option>
                    </select>
                  </label>
                  <div className="date-fields">
                    <label>
                      Start date
                      <input
                        required
                        type="date"
                        name="start"
                        value={dates.start}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(e) =>
                          setDates({ ...dates, start: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      End date
                      <input
                        required
                        type="date"
                        name="end"
                        value={dates.end}
                        min={
                          dates.start || new Date().toISOString().slice(0, 10)
                        }
                        onChange={(e) =>
                          setDates({ ...dates, end: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  {validDate(dates.start) &&
                    validDate(dates.end) &&
                    dates.end >= dates.start && (
                      <p className="policy-note">
                        {workdays(dates.start, dates.end)} working days
                        requested. Weekends excluded. Balance is checked before
                        submission.
                      </p>
                    )}
                  <label>
                    Reason
                    <textarea
                      name="reason"
                      required
                      maxLength={1000}
                      placeholder="Help your manager understand your request."
                    />
                  </label>
                </>
              )}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setModal("")}
                >
                  Cancel
                </button>
                <button className="primary" disabled={busy}>
                  {busy
                    ? "Saving…"
                    : modal === "decision"
                      ? "Confirm " + decision?.status.toLowerCase()
                      : modal === "leave"
                        ? "Submit request"
                        : modal === "department"
                          ? "Create department"
                          : "Add employee"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
