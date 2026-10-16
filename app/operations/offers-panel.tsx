"use client";
import { useEffect, useState } from "react";
import { api, dateTime } from "./types";
type Offer = {
  id: number;
  applicant_id: number;
  letter: string;
  snapshot: string;
  display_status: string;
  expires: number;
  first_viewed: string | null;
  response_name: string;
  responded: string | null;
};
type Data = {
  offers: Offer[];
  candidates: { id: number; title: string }[];
  templates: { id: number; title: string }[];
  events: { id: number; offer_id: number; action: string; created: string }[];
};
export default function OffersPanel() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [link, setLink] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    api("offers")
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
    setLink("");
    try {
      const result = await api("offers", body);
      if (result.path) setLink(window.location.origin + result.path);
      setMessage(
        result.path
          ? "Private link created. Share it manually with the intended candidate."
          : "Offer action saved.",
      );
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save offer.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel ops-form">
        <h2>Issue a candidate offer letter</h2>
        <p>
          Use an active letter template and a candidate at the Offer stage with
          current hiring approval. Supported placeholders:{" "}
          {
            "{{candidate_name}}, {{employee_name}}, {{company_name}}, {{role}}, {{start_date}}, {{offer_terms}}"
          }
          . Terms are appended if the template has no offer-terms placeholder.
        </p>
        <p>
          Issued letters are immutable. Revoke an unanswered offer before
          revising it. Responses and prior letters stay in history. Sharing does
          not send email or create an account.
        </p>
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
        {link && (
          <label>
            Private candidate offer link
            <input
              aria-label="Private candidate offer link"
              readOnly
              value={link}
              onFocus={(e) => e.target.select()}
            />
            <small>
              Shown only now. Generate a replacement link if lost; the old link
              will stop working.
            </small>
          </label>
        )}
        {!data ? (
          <p>Loading offers…</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void perform({
                action: "issue",
                applicant_id: Number(f.get("applicant_id")),
                template_id: Number(f.get("template_id")),
                start_date: f.get("start_date"),
                expires_days: Number(f.get("expires_days")),
                terms: f.get("terms"),
                confirmed: true,
              });
            }}
          >
            <label>
              Offer candidate
              <select name="applicant_id" aria-label="Offer candidate" required>
                <option value="">Choose candidate</option>
                {data.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Offer letter template
              <select
                name="template_id"
                aria-label="Offer letter template"
                required
              >
                <option value="">Choose template</option>
                {data.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Proposed start date
              <input name="start_date" type="date" required />
            </label>
            <label>
              Link lifetime (days)
              <input
                name="expires_days"
                type="number"
                min={1}
                max={30}
                defaultValue={7}
                required
              />
            </label>
            <label>
              Offer terms
              <textarea name="terms" maxLength={10000} required />
            </label>
            <label className="ops-check">
              <input type="checkbox" required />I reviewed the template and
              terms and authorize issuing this letter
            </label>
            <button className="primary" disabled={busy}>
              Issue offer and private link
            </button>
          </form>
        )}
        <p>
          <a href="/operations?tab=templates">Manage letter templates</a> ·{" "}
          <a href="/operations?tab=applicants">Open recruiting pipeline</a>
        </p>
      </section>
      <section className="panel ops-form">
        <h2>Offer response tracking</h2>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setError("");
            setRevision((v) => v + 1);
          }}
        >
          Refresh offer responses
        </button>
        <p>
          Acceptance records a response from the private link holder, with their
          typed name and timestamp. It does not verify identity or create an
          employee. If an offer exists, the latest matching offer must be
          accepted before Hired.
        </p>
        {data?.offers.map((o) => {
          const frozen = JSON.parse(o.snapshot);
          return (
            <article className="ops-record" key={o.id}>
              <h3>
                {frozen.candidate} · {o.display_status}
              </h3>
              <p>
                Start {frozen.start_date} · Link expires{" "}
                {dateTime(new Date(o.expires).toISOString())}
              </p>
              <p>
                {o.first_viewed
                  ? `First viewed ${dateTime(o.first_viewed)}`
                  : "Not viewed"}
              </p>
              {o.responded && (
                <p>
                  Response: {o.display_status} · {o.response_name} ·{" "}
                  {dateTime(o.responded)}
                </p>
              )}
              <details>
                <summary>Issued letter and history</summary>
                <div className="offer-letter">{o.letter}</div>
                <ul>
                  {data.events
                    .filter((e) => e.offer_id === o.id)
                    .map((e) => (
                      <li key={e.id}>
                        {e.action} · {dateTime(e.created)}
                      </li>
                    ))}
                </ul>
              </details>
              {o.display_status === "Issued" && (
                <div className="ops-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void perform({ action: "rotate", offer_id: o.id })
                    }
                  >
                    Replace private link for {frozen.candidate}
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void perform({ action: "revoke", offer_id: o.id })
                    }
                  >
                    Revoke offer for {frozen.candidate}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </>
  );
}
