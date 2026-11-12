"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getSafeRedirectPath } from "@/lib/auth-redirect";
import { handleAuthLink, sendPasswordSetupEmail, supabase } from "@/lib/supabase-browser";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-red-700 focus:outline-none focus:ring-2 focus:ring-red-700/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

function getReturnPath() {
  return getSafeRedirectPath(
    new URLSearchParams(window.location.search).get("next"),
    window.location.origin
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"sign-in" | "recovery" | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const linkError = new URLSearchParams(window.location.search).get("error");
    if (linkError === "invalid-link") {
      setError("That invite or password link is invalid or has expired. Ask for a new one.");
    } else if (linkError === "auth-unavailable") {
      setError("Could not complete the authentication link. Please try again or ask for a new one.");
    }

    if (!supabase) {
      setError("Supabase authentication is not configured.");
      setCheckingSession(false);
      return;
    }

    const client = supabase;
    let active = true;
    handleAuthLink().then(async (handled) => {
      if (handled || !active) return;
      if (linkError === "invalid-link" || linkError === "auth-unavailable") {
        setCheckingSession(false);
        return;
      }
      const { data, error: sessionError } = await client.auth.getSession();
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      if (data.session) {
        window.location.replace(getReturnPath());
        return;
      }
      setCheckingSession(false);
    });

    return () => {
      active = false;
    };
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError("Supabase authentication is not configured.");
      return;
    }

    setBusy("sign-in");
    setError(null);
    setMessage(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      window.location.replace(getReturnPath());
    } catch (signInError) {
      setError(
        signInError instanceof Error ? signInError.message : "Could not sign in."
      );
      setBusy(null);
    }
  }

  async function sendSetupEmail() {
    if (!email.trim()) {
      setMessage(null);
      setError("Enter your email address to receive a password setup link.");
      return;
    }

    setBusy("recovery");
    setError(null);
    setMessage(null);
    try {
      await sendPasswordSetupEmail(email.trim());
      setMessage("If an account exists for that email, a password setup link has been sent.");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send the password setup email.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-700 text-lg font-semibold text-amber-300">
            中
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red-800 dark:text-red-300">
              Chinese News Archive
            </p>
            <h1 className="text-xl font-semibold">Sign in</h1>
          </div>
        </div>
        <p className="mb-5 text-sm text-slate-600 dark:text-slate-400">
          This archive is private. Sign in with an invited account, or ask the site administrator for access.
        </p>
        <form className="space-y-4" onSubmit={signIn}>
          <div>
            <label htmlFor="login-email" className="mb-1 block text-xs font-medium">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="login-password" className="mb-1 block text-xs font-medium">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </div>
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {message}
            </p>
          )}
          <button
            type="submit"
            disabled={busy !== null || checkingSession || !supabase}
            className="w-full rounded-lg border border-amber-400 bg-red-700 px-4 py-2 text-sm font-semibold text-amber-200 shadow-sm hover:bg-red-800 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:ring-offset-2"
          >
            {checkingSession ? "Checking account…" : busy === "sign-in" ? "Signing in…" : "Sign in"}
          </button>
          <button
            type="button"
            onClick={sendSetupEmail}
            disabled={busy !== null || checkingSession || !supabase}
            className="w-full text-sm font-medium text-red-800 underline hover:text-red-900 disabled:cursor-wait disabled:opacity-60 dark:text-red-300 dark:hover:text-red-200"
          >
            {busy === "recovery" ? "Sending link…" : "Set or reset your password"}
          </button>
        </form>
      </section>
    </main>
  );
}
