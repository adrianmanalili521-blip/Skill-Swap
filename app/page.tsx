"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { getAuthErrorMessage } from "@/lib/auth-errors";

type AuthMode = "signin" | "signup";

export default function Home() {
  const { user, loading, signIn, signUp, signInWithGoogle, signOut } = useAuth();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    try {
      if (mode === "signup") {
        await signUp(email, password, String(formData.get("name") ?? "").trim());
      } else {
        await signIn(email, password);
      }
    } catch (authError) {
      setError(getAuthErrorMessage(authError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setSubmitting(true);

    try {
      await signInWithGoogle();
    } catch (authError) {
      setError(getAuthErrorMessage(authError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    setError(null);
    setSubmitting(true);

    try {
      await signOut();
    } catch (authError) {
      setError(getAuthErrorMessage(authError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <aside className="welcome-panel">
        <div className="welcome-grid" aria-hidden="true" />
        <Link className="brand" href="/" aria-label="Skill Swap home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <span>skill swap</span>
        </Link>

        <div className="welcome-copy">
          <p className="eyebrow">A little give, a lot to learn</p>
          <h1>Skill Swap</h1>
          <p className="welcome-subtitle">Good things grow when they&apos;re shared.</p>
        </div>

        <div className="exchange-board" aria-label="A sample skill exchange">
          <article className="skill-note skill-note-clay">
            <span className="note-label">OFFERING</span>
            <strong>Wheel pottery</strong>
            <span className="note-person">Mara · 45 min</span>
          </article>
          <span className="exchange-mark" aria-hidden="true">↔</span>
          <article className="skill-note skill-note-sky">
            <span className="note-label">LOOKING FOR</span>
            <strong>Conversational Spanish</strong>
            <span className="note-person">Luis · 1 session</span>
          </article>
        </div>

        <p className="welcome-foot">Make something of what you know.</p>
      </aside>

      <section className="form-panel" aria-label="Account access">
        <div className="form-wrap">
          <div className="mobile-brand" aria-hidden="true">skill swap</div>
          {loading ? (
            <div className="session-check" role="status">
              <span className="loading-indicator" />
              <span>Checking your session</span>
            </div>
          ) : user ? (
            <div className="signed-in-view">
              <span className="signed-in-mark" aria-hidden="true">✓</span>
              <p className="eyebrow">You&apos;re all set</p>
              <h2>Welcome{user.displayName ? `, ${user.displayName}` : " back"}.</h2>
              <p className="form-description">Signed in as {user.email}.</p>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="submit-button" onClick={handleSignOut} disabled={submitting}>
                {submitting ? "Signing out..." : "Sign out"}
              </button>
            </div>
          ) : (
            <>
              <div className="form-heading">
                <p className="eyebrow">Your next chapter</p>
                <h2>{mode === "signin" ? "Good to see you." : "Come on in."}</h2>
                <p className="form-description">
                  {mode === "signin"
                    ? "Sign in to pick up where you left off."
                    : "Create an account and get started."}
                </p>
              </div>

              <div className="auth-tabs" role="tablist" aria-label="Account access">
                <button
                  id="signin-tab"
                  className={mode === "signin" ? "auth-tab active" : "auth-tab"}
                  type="button"
                  role="tab"
                  aria-selected={mode === "signin"}
                  aria-controls="auth-form"
                  onClick={() => { setMode("signin"); setError(null); }}
                >
                  Sign in
                </button>
                <button
                  id="signup-tab"
                  className={mode === "signup" ? "auth-tab active" : "auth-tab"}
                  type="button"
                  role="tab"
                  aria-selected={mode === "signup"}
                  aria-controls="auth-form"
                  onClick={() => { setMode("signup"); setError(null); }}
                >
                  Create account
                </button>
              </div>

              <form id="auth-form" role="tabpanel" aria-labelledby={`${mode}-tab`} onSubmit={handleSubmit}>
                {mode === "signup" && (
                  <label className="field">
                    <span>Your name</span>
                    <input autoComplete="name" name="name" placeholder="e.g. Alex Rivera" required minLength={2} />
                  </label>
                )}
                <label className="field">
                  <span>Email address</span>
                  <input
                    autoComplete="email"
                    autoFocus
                    name="email"
                    placeholder="you@example.com"
                    required
                    type="email"
                  />
                </label>
                <label className="field">
                  <span>Password</span>
                  <input
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    minLength={6}
                    name="password"
                    placeholder="At least 6 characters"
                    required
                    type="password"
                  />
                </label>

                {error && <p className="form-error" role="alert">{error}</p>}

                <button className="submit-button" type="submit" disabled={submitting}>
                  {submitting
                    ? mode === "signin" ? "Signing in..." : "Creating account..."
                    : mode === "signin" ? "Sign in" : "Create account"}
                  {!submitting && <span aria-hidden="true">→</span>}
                </button>
              </form>

              <div className="divider"><span>or</span></div>

              <button className="google-button" type="button" onClick={handleGoogleSignIn} disabled={submitting}>
                <span className="google-mark" aria-hidden="true">G</span>
                Continue with Google
              </button>

              <p className="form-footnote">
                By continuing, you agree to be kind and curious.
              </p>
            </>
          )}
        </div>
        <span className="form-corner" aria-hidden="true">SS / 01</span>
      </section>
    </main>
  );
}