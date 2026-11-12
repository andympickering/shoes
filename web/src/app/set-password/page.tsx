"use client";

import { useState, type FormEvent } from "react";
import { getSafeRedirectPath } from "@/lib/auth-redirect";
import { supabase } from "@/lib/supabase-browser";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-red-700 focus:outline-none focus:ring-2 focus:ring-red-700/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

function getReturnPath() {
  return getSafeRedirectPath(
    new URLSearchParams(window.location.search).get("next"),
    window.location.origin
  );
}

export default function SetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (!supabase) {
      setError("Supabase authentication is not configured.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      window.location.replace(getReturnPath());
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Could not save your password."
      );
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
        <h1 className="text-xl font-semibold">Set your password</h1>
        <p className="mb-5 mt-2 text-sm text-slate-600 dark:text-slate-400">
          Choose a password for your invited archive account.
        </p>
        <form className="space-y-4" onSubmit={setNewPassword}>
          <div>
            <label htmlFor="new-password" className="mb-1 block text-xs font-medium">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className="mb-1 block text-xs font-medium">
              Confirm password
            </label>
            <input
              id="confirm-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className={inputClass}
            />
          </div>
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !supabase}
            className="w-full rounded-lg border border-amber-400 bg-red-700 px-4 py-2 text-sm font-semibold text-amber-200 shadow-sm hover:bg-red-800 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:ring-offset-2"
          >
            {busy ? "Saving…" : "Save password"}
          </button>
        </form>
      </section>
    </main>
  );
}
