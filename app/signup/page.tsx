"use client";
import { useState } from "react";
export default function Signup() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-screen">
      <section className="panel login-card">
        <h1>Create your company workspace</h1>
        <p>
          Import your team, prepare payroll, and give employees mobile
          self-service.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const r = await fetch("/api/companies", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(
                  Object.fromEntries(new FormData(e.currentTarget)),
                ),
              });
              const b = await r.json();
              if (!r.ok) throw Error(b.error);
              window.location.assign("/operations");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Unable to register");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Company name
            <input name="company" required maxLength={120} />
          </label>
          <label>
            Your name
            <input name="name" required maxLength={120} autoComplete="name" />
          </label>
          <label>
            Work email
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Creating…" : "Create company"}
          </button>
        </form>
        <a href="/login">Already have an account? Sign in</a>
      </section>
    </div>
  );
}
