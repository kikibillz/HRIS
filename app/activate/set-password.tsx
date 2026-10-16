"use client";
import { useEffect, useRef, useState } from "react";

export default function SetPassword() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const initialized = useRef(false);
  useEffect(() => {
    function readLink() {
      const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
      setToken(value);
      setDone(false);
      setError("");
      // Keep the bearer token out of browser history and subsequent navigation.
      window.history.replaceState(null, "", window.location.pathname);
    }
    if (!initialized.current) { initialized.current = true; readLink(); }
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);
  return <div className="login-screen"><section className="panel login-card">
    <p className="eyebrow">PEOPLEOS · ACCOUNT ACCESS</p>
    <h1>{done ? "Your password is ready." : "Set your password"}</h1>
    {done ? <>
      <p>Your invitation or recovery link is now used. Sign in with your work email and new password.</p>
      <a className="primary" href="/login">Continue to sign in</a>
    </> : token === null ? <p>Loading your secure link…</p> : !token ? <>
      <p role="alert">Open the complete invitation or recovery link shared by your administrator. If you refreshed this page, reopen that link.</p>
      <a href="/login">Back to sign in</a>
    </> : <>
      <p>Choose a unique password of 12–128 characters. Existing sessions will be signed out.</p>
      <form onSubmit={async (event) => {
        event.preventDefault();
        const body = Object.fromEntries(new FormData(event.currentTarget));
        setError("");
        if (body.password !== body.confirm_password) { setError("Passwords do not match."); return; }
        setBusy(true);
        try {
          const response = await fetch("/api/account-links/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password: body.password }) });
          const result = await response.json();
          if (!response.ok) throw Error(result.error);
          setDone(true); setToken("");
        } catch (error) { setError(error instanceof Error ? error.message : "Unable to set password."); }
        finally { setBusy(false); }
      }}>
        <label>New password<input type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
        <label>Confirm new password<input type="password" name="confirm_password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
        {error && <p role="alert" className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </>}
  </section></div>;
}
