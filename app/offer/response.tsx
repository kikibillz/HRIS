"use client";
import { useEffect, useRef, useState } from "react";
import { dateTime } from "../operations/types";
type Offer = {
  company: string;
  candidate: string;
  job: string;
  start_date: string;
  letter: string;
  status: string;
  expires: number;
  response_name: string;
  responded: string | null;
};
export default function OfferResponse() {
  const [token, setToken] = useState(""),
    [offer, setOffer] = useState<Offer | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const initialized = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    function read() {
      const ticket = ++generation.current;
      const value =
        new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
      window.history.replaceState(null, "", window.location.pathname);
      setToken(value);
      setOffer(null);
      setError("");
      if (!value) {
        setError(
          "Open the complete private offer link. If you refreshed, reopen the link shared with you.",
        );
        return;
      }
      fetch("/api/offer-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "view", token: value }),
      })
        .then(async (r) => {
          const result = await r.json();
          if (!r.ok) throw Error(result.error);
          if (ticket === generation.current) setOffer(result.offer);
        })
        .catch((e) => {
          if (ticket === generation.current) setError(e.message);
        });
    }
    if (!initialized.current) {
      initialized.current = true;
      read();
    }
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return (
    <main className="offer-page">
      <section className="panel ops-form">
        <h1>{offer ? `Offer from ${offer.company}` : "Your private offer"}</h1>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!offer && !error && <p>Loading your offer…</p>}
        {offer && (
          <>
            <p>
              For {offer.candidate} · {offer.job} · Start {offer.start_date}
            </p>
            <p>
              Link expires {dateTime(new Date(offer.expires).toISOString())}
            </p>
            <div className="offer-letter">{offer.letter}</div>
            <div className="offer-controls">
              <button className="secondary" onClick={() => window.print()}>
                Print / save offer
              </button>
              <p>
                This private link allows its holder to view and respond to this
                offer. Keep it private. Your typed name and response will be
                recorded; this is not an identity-verified signature service.
              </p>
            </div>
            {offer.status === "Issued" ? (
              <form
                className="offer-controls"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const ticket = generation.current;
                  setBusy(true);
                  setError("");
                  try {
                    const r = await fetch("/api/offer-response", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "respond",
                        token,
                        decision: f.get("decision"),
                        name: f.get("name"),
                        confirmed: true,
                      }),
                    });
                    const result = await r.json();
                    if (!r.ok) throw Error(result.error);
                    if (ticket === generation.current) setOffer(result.offer);
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Unable to record your response.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Your full name
                  <input
                    name="name"
                    required
                    maxLength={120}
                    autoComplete="name"
                  />
                </label>
                <label>
                  Your response
                  <select
                    aria-label="Your offer response"
                    name="decision"
                    required
                    defaultValue=""
                  >
                    <option value="">Choose response</option>
                    <option value="Accepted">Accept offer</option>
                    <option value="Declined">Decline offer</option>
                  </select>
                </label>
                <label className="ops-check">
                  <input type="checkbox" required />I confirm this is my
                  response to the offer shown above
                </label>
                <button className="primary" disabled={busy}>
                  {busy ? "Recording response…" : "Record my response"}
                </button>
              </form>
            ) : (
              <p role="status">
                Response recorded: {offer.status} · {offer.response_name}
                {offer.responded ? ` · ${dateTime(offer.responded)}` : ""}. This
                response is final.
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
