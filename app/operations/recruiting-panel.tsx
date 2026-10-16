"use client";
import { useEffect, useState } from "react";
import { api, type Context } from "./types";
type Card = {
  id: number;
  applicant_id: number;
  interviewer_id: number;
  interviewer_name: string;
  status: string;
  ratings: string;
  notes: string;
  recommendation: string;
};
type Approval = {
  id: number;
  applicant_id: number;
  approver_id: number;
  requested_by: number;
  requester_name: string;
  approver_name: string;
  status: string;
  closed_state: string;
  display_status: string;
  closure_reason: string | null;
  replacement_id: number | null;
  reassignment_reason: string | null;
  previous_request_id: number | null;
  request_note: string;
  decision_note: string;
  snapshot: string;
};
type Data = {
  candidates: { id: number; title: string; job: string; status: string }[];
  cards: Card[];
  approvals: Approval[];
  interviewers: { id: number; name: string; access: string }[];
};
function FrozenEvidence({ snapshot }: { snapshot: string }) {
  const evidence = JSON.parse(snapshot) as {
    candidate: { title: string; email: string; body: string };
    job: { title: string; body: string };
    scorecards: Card[];
  };
  return (
    <details>
      <summary>Frozen evidence for this request</summary>
      <h3>
        {evidence.candidate.title} · {evidence.job.title}
      </h3>
      <p>{evidence.candidate.email}</p>
      <p className="preserve-lines">
        Candidate notes: {evidence.candidate.body || "None"}
      </p>
      <p className="preserve-lines">
        Job requirements: {evidence.job.body || "None"}
      </p>
      {evidence.scorecards.map((card) => {
        const ratings = JSON.parse(card.ratings);
        return (
          <section key={card.id}>
            <h3>
              {card.interviewer_name} · {card.recommendation}
            </h3>
            <p>
              Role knowledge: {ratings.knowledge}/5 · Problem solving:{" "}
              {ratings.problem_solving}/5 · Communication:{" "}
              {ratings.communication}/5
            </p>
            <p className="preserve-lines">{card.notes}</p>
          </section>
        );
      })}
    </details>
  );
}
export default function RecruitingPanel({ context }: { context: Context }) {
  const [data, setData] = useState<Data | null>(null),
    [candidate, setCandidate] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const admin = context.user.access === "admin";
  useEffect(() => {
    let active = true;
    api("recruiting")
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  async function perform(body: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("recruiting", body);
      setMessage("Recruiting action saved.");
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="ops-success">
          {message}
        </p>
      )}
      <section className="panel ops-form">
        <h2>Interview evidence and hiring decisions</h2>
        <p>
          Interviewers see their assigned candidates and their own scorecards.
          Submitted scorecards are immutable. Hiring approval requires a
          different manager or administrator, reviews all submitted scorecards,
          and is invalidated by changes to the candidate, job or interview
          evidence. Decisions are made by people; ratings do not automatically
          select or reject candidates.
        </p>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => setRevision((v) => v + 1)}
        >
          Refresh interview evidence
        </button>
        {admin && (
          <p>
            <a href="/operations?tab=applicants">Open recruiting pipeline</a>
          </p>
        )}
      </section>
      {!data ? (
        <p>Loading interview evidence…</p>
      ) : (
        <>
          <section className="panel ops-form">
            <label>
              Candidate
              <select
                aria-label="Interview candidate"
                value={candidate}
                onChange={(e) => setCandidate(e.target.value)}
              >
                <option value="">Choose candidate</option>
                {data.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} · {c.job} · {c.status}
                  </option>
                ))}
              </select>
            </label>
            {!data.candidates.length && (
              <p>No candidates available to your account.</p>
            )}
          </section>
          {candidate && (
            <>
              {admin && (
                <section className="panel ops-form">
                  <h2>Assign an interview</h2>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void perform({
                        action: "assign",
                        applicant_id: Number(candidate),
                        interviewer_id: Number(f.get("interviewer_id")),
                      });
                    }}
                  >
                    <label>
                      Interviewer
                      <select
                        required
                        name="interviewer_id"
                        aria-label="Interview assignee"
                      >
                        <option value="">Choose interviewer</option>
                        {data.interviewers.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="primary" disabled={busy}>
                      Assign interview
                    </button>
                  </form>
                </section>
              )}
              <div className="ops-cards">
                {data.cards
                  .filter((c) => c.applicant_id === Number(candidate))
                  .map((card) => (
                    <section className="panel ops-record" key={card.id}>
                      <h2>
                        {card.interviewer_name} · {card.status}
                      </h2>
                      {card.status === "Submitted" ? (
                        <>
                          <p>Recommendation: {card.recommendation}</p>
                          <p>
                            Role knowledge: {JSON.parse(card.ratings).knowledge}
                            /5 · Problem solving:{" "}
                            {JSON.parse(card.ratings).problem_solving}/5 ·
                            Communication:{" "}
                            {JSON.parse(card.ratings).communication}/5
                          </p>
                          <p className="preserve-lines">{card.notes}</p>
                        </>
                      ) : card.interviewer_id === context.user.id ? (
                        <form
                          className="ops-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            void perform({
                              action: "submit",
                              card_id: card.id,
                              ratings: {
                                knowledge: Number(f.get("knowledge")),
                                problem_solving: Number(
                                  f.get("problem_solving"),
                                ),
                                communication: Number(f.get("communication")),
                              },
                              notes: f.get("notes"),
                              recommendation: f.get("recommendation"),
                            });
                          }}
                        >
                          {[
                            ["knowledge", "Role knowledge"],
                            ["problem_solving", "Problem solving"],
                            ["communication", "Communication"],
                          ].map(([key, label]) => (
                            <label key={key}>
                              {label} (1–5)
                              <input
                                name={key}
                                type="number"
                                min={1}
                                max={5}
                                required
                              />
                            </label>
                          ))}
                          <label>
                            Interview evidence
                            <textarea name="notes" maxLength={4000} required />
                          </label>
                          <label>
                            Recommendation
                            <select
                              required
                              name="recommendation"
                              aria-label="Interview recommendation"
                            >
                              <option value="">Choose recommendation</option>
                              <option>Hire</option>
                              <option>Hold</option>
                              <option>No hire</option>
                            </select>
                          </label>
                          <button className="primary" disabled={busy}>
                            Submit final scorecard
                          </button>
                        </form>
                      ) : (
                        <p>Waiting for the assigned interviewer.</p>
                      )}
                    </section>
                  ))}
              </div>
              {admin && (
                <>
                  <section className="panel ops-form">
                    <h2>Request hiring approval</h2>
                    <p>
                      All assigned scorecards must be submitted. Choose another
                      active manager or administrator. Approval does not change
                      the candidate’s stage or create an employee account.
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void perform({
                          action: "request",
                          applicant_id: Number(candidate),
                          approver_id: Number(f.get("approver_id")),
                          note: f.get("note"),
                        });
                      }}
                    >
                      <label>
                        Approving manager or administrator
                        <select
                          required
                          name="approver_id"
                          aria-label="Hiring approver"
                        >
                          <option value="">Choose another approver</option>
                          {data.interviewers
                            .filter(
                              (i) =>
                                ["admin", "manager"].includes(i.access) &&
                                i.id !== context.user.id,
                            )
                            .map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Hiring rationale
                        <textarea required name="note" maxLength={2000} />
                      </label>
                      <button className="primary" disabled={busy}>
                        Request hiring approval
                      </button>
                    </form>
                  </section>
                </>
              )}
              {data.approvals
                .filter((a) => a.applicant_id === Number(candidate))
                .map((a) => (
                  <section className="panel ops-form" key={a.id}>
                    <h2>
                      Hiring request #{a.id} · {a.display_status}
                    </h2>
                    <p>
                      Requested by {a.requester_name} · Approver{" "}
                      {a.approver_name}
                    </p>
                    <p>{a.request_note}</p>
                    {a.closure_reason && (
                      <p>
                        {a.display_status} reason: {a.closure_reason}
                        {a.replacement_id
                          ? ` · Replacement request #${a.replacement_id}`
                          : ""}
                      </p>
                    )}
                    {a.reassignment_reason && (
                      <p>
                        Reassigned from request #{a.previous_request_id}:{" "}
                        {a.reassignment_reason}
                      </p>
                    )}
                    {a.decision_note && (
                      <p>Decision rationale: {a.decision_note}</p>
                    )}
                    <FrozenEvidence snapshot={a.snapshot} />
                    {admin && a.status === "Pending" && !a.closed_state && (
                      <details>
                        <summary>Manage unanswered request #{a.id}</summary>
                        <p>
                          Withdraw closes this request without a decision.
                          Reassignment keeps the exact frozen evidence and
                          removes the previous approver’s access. Stale evidence
                          still needs a new review request.
                        </p>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            void perform({
                              action: "withdraw",
                              approval_id: a.id,
                              note: f.get("note"),
                            });
                          }}
                        >
                          <label>
                            Withdrawal reason for request {a.id}
                            <textarea name="note" required maxLength={2000} />
                          </label>
                          <button className="secondary" disabled={busy}>
                            Withdraw hiring request #{a.id}
                          </button>
                        </form>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            void perform({
                              action: "reassign",
                              approval_id: a.id,
                              approver_id: Number(f.get("approver_id")),
                              note: f.get("note"),
                            });
                          }}
                        >
                          <label>
                            Replacement approver
                            <select
                              required
                              aria-label={`Replacement approver for request ${a.id}`}
                              name="approver_id"
                            >
                              <option value="">Choose replacement</option>
                              {data.interviewers
                                .filter(
                                  (i) =>
                                    ["admin", "manager"].includes(i.access) &&
                                    ![
                                      context.user.id,
                                      a.requested_by,
                                      a.approver_id,
                                    ].includes(i.id),
                                )
                                .map((i) => (
                                  <option key={i.id} value={i.id}>
                                    {i.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>
                            Reassignment reason for request {a.id}
                            <textarea name="note" required maxLength={2000} />
                          </label>
                          <button className="secondary" disabled={busy}>
                            Reassign hiring request #{a.id}
                          </button>
                        </form>
                      </details>
                    )}

                    {a.status === "Pending" &&
                      !a.closed_state &&
                      a.approver_id === context.user.id && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            void perform({
                              action: "decide",
                              approval_id: a.id,
                              decision: f.get("decision"),
                              note: f.get("note"),
                            });
                          }}
                        >
                          <label>
                            Hiring decision
                            <select
                              required
                              name="decision"
                              aria-label="Hiring decision"
                            >
                              <option value="">Choose decision</option>
                              <option>Approved</option>
                              <option>Rejected</option>
                            </select>
                          </label>
                          <label>
                            Decision rationale
                            <textarea name="note" required maxLength={2000} />
                          </label>
                          <button className="primary" disabled={busy}>
                            Record hiring decision
                          </button>
                        </form>
                      )}
                  </section>
                ))}
            </>
          )}
        </>
      )}
    </>
  );
}
