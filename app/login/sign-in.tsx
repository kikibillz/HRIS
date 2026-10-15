"use client";
import { useState } from "react";
export default function Login({ setup }: { setup: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="login-screen">
      <section className="panel login-card">
        <p className="eyebrow">PEOPLEOS · YOUR PEOPLE, CONNECTED</p>
        <h1>{setup ? "Make this workspace yours." : "Welcome back."}</h1>
        <p className="subtitle">
          {setup
            ? "Create the first administrator account to review the prototype."
            : "Sign in to manage your people and time off."}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const body = Object.fromEntries(new FormData(e.currentTarget));
              const res = await fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...body,
                  action: setup ? "setup" : "login",
                }),
              });
              const result = await res.json();
              if (!res.ok) throw Error(result.error);
              window.location.assign("/");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Unable to sign in");
            } finally {
              setBusy(false);
            }
          }}
        >
          {setup && (
            <label>
              Your name
              <input name="name" required maxLength={120} autoComplete="name" />
            </label>
          )}
          <label>
            Work email
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              maxLength={254}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              autoComplete={setup ? "new-password" : "current-password"}
              minLength={12}
              maxLength={128}
              required
            />
            <small>At least 12 characters.</small>
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Please wait…" : setup ? "Create workspace" : "Sign in"}
          </button>
        </form>
        <p className="login-note">
          {setup
            ? "Keep this preview private while setting up. Initial setup closes after your account is created."
            : "Ask your workspace administrator for an account. Use sample data while reviewing this prototype."}
        </p>
      </section>
    </div>
  );
}
