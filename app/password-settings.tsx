"use client";
import { useState } from "react";

export default function PasswordSettings() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <section className="panel account-panel">
    <div className="section-head"><h2>Change password</h2></div>
    <p>Choose a unique password. You’ll be signed out on every device after saving.</p>
    <form onSubmit={async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(event.currentTarget));
      setError("");
      if (body.password !== body.confirm_password) { setError("New passwords do not match."); return; }
      setBusy(true);
      try {
        const response = await fetch("/api/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const result = await response.json();
        if (!response.ok) throw Error(result.error);
        window.location.assign("/login?password=changed");
      } catch (error) { setError(error instanceof Error ? error.message : "Unable to change password."); }
      finally { setBusy(false); }
    }}>
      <label>Current password<input type="password" name="current_password" autoComplete="current-password" required minLength={12} maxLength={128} /></label>
      <label>New password<input type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
      <label>Confirm new password<input type="password" name="confirm_password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? "Saving…" : "Change password and sign out"}</button>
    </form>
  </section>;
}
