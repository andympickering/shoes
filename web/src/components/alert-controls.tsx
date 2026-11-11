"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import type { Session } from "@supabase/supabase-js";
import { DEFAULT_MAX_ARTICLES, MAX_ALERT_ARTICLES } from "@/lib/alert-validation";
import { supabase } from "@/lib/supabase";

type Modal = "create" | "manage" | null;
type ManageTab = "alerts" | "account";
type AccountMode = "sign_in" | "sign_up";

interface AlertForm {
  searchTerms: string;
  timeSpan: string;
  frequency: string;
  deliveryTimeUtc: string;
  maxArticles: string;
  emails: string;
  consent: boolean;
}

interface ManagedAlert {
  id: string;
  search_terms: string;
  time_span: string;
  frequency: string;
  delivery_time_utc: string;
  max_articles: number;
  emails: string[];
  active: boolean;
  next_delivery_at: string;
  last_sent_at: string | null;
  created_at: string;
}

const emptyAlertForm: AlertForm = {
  searchTerms: "",
  timeSpan: "today",
  frequency: "daily",
  deliveryTimeUtc: "09:00",
  maxArticles: String(DEFAULT_MAX_ARTICLES),
  emails: "",
  consent: false,
};

const fieldClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-red-700 focus:outline-none focus:ring-2 focus:ring-red-700/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";
const labelClass =
  "mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300";
const primaryButtonClass =
  "rounded-lg border border-amber-400 bg-red-700 px-4 py-2 text-sm font-semibold text-amber-200 shadow-sm hover:bg-red-800 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:ring-offset-2 dark:border-amber-500 dark:bg-red-800 dark:hover:bg-red-700";
const secondaryButtonClass =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-red-700/30 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function getResponseError(response: Response, fallback: string) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof result.error === "string" ? result.error : fallback
    );
  }
  return result;
}

function getAuthorization(session: Session) {
  return { Authorization: `Bearer ${session.access_token}` };
}

function formatDelivery(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

function alertToForm(alert: ManagedAlert): AlertForm {
  return {
    searchTerms: alert.search_terms,
    timeSpan: alert.time_span,
    frequency: alert.frequency,
    deliveryTimeUtc: alert.delivery_time_utc.slice(0, 5),
    maxArticles: String(alert.max_articles),
    emails: alert.emails.join("; "),
    consent: false,
  };
}

export function AlertControls() {
  const [modal, setModal] = useState<Modal>(null);
  const [manageTab, setManageTab] = useState<ManageTab>("alerts");
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [accountMode, setAccountMode] = useState<AccountMode>("sign_in");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [alertForm, setAlertForm] = useState<AlertForm>(emptyAlertForm);
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertSaved, setAlertSaved] = useState(false);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [managedAlerts, setManagedAlerts] = useState<ManagedAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [editingAlertId, setEditingAlertId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<AlertForm>(emptyAlertForm);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [pendingAlertId, setPendingAlertId] = useState<string | null>(null);
  const alertSearchRef = useRef<HTMLInputElement>(null);
  const modalCloseRef = useRef<HTMLButtonElement>(null);
  const alertButtonRef = useRef<HTMLButtonElement>(null);
  const manageButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!supabase) {
      setSessionLoading(false);
      return;
    }

    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setAccountError(error.message);
      setSession(data.session);
      setSessionLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setSessionLoading(false);
      setAccountError(null);
      if (newSession) {
        setAccountPassword("");
        setAccountMessage(null);
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!modal) return;
    const trigger = modal === "manage" ? manageButtonRef.current : alertButtonRef.current;
    const focusTimer = window.setTimeout(() => modalCloseRef.current?.focus(), 0);
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !alertSaving && !editSaving && !accountBusy) {
        setModal(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      trigger?.focus();
    };
  }, [modal, alertSaving, editSaving, accountBusy]);

  useEffect(() => {
    if (modal === "create" && session && !alertSaved) {
      alertSearchRef.current?.focus();
    }
  }, [modal, session, alertSaved]);

  const loadManagedAlerts = useCallback(async (currentSession: Session) => {
    setAlertsLoading(true);
    setManageError(null);
    try {
      const response = await fetch("/api/alerts", {
        headers: getAuthorization(currentSession),
      });
      const result = await getResponseError(response, "Could not load your alerts.");
      setManagedAlerts(result.alerts as ManagedAlert[]);
    } catch (error) {
      setManageError(getErrorMessage(error, "Could not load your alerts."));
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (modal === "manage" && manageTab === "alerts" && session) {
      void loadManagedAlerts(session);
    }
  }, [modal, manageTab, session, loadManagedAlerts]);

  async function saveAlert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setAlertSaving(true);
    setAlertError(null);
    try {
      const response = await fetch("/api/alerts", {
        method: "POST",
        headers: {
          ...getAuthorization(session),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...alertForm, maxArticles: Number(alertForm.maxArticles) }),
      });
      await getResponseError(response, "Could not save this alert.");
      setAlertSaved(true);
      setAlertForm(emptyAlertForm);
    } catch (error) {
      setAlertError(getErrorMessage(error, "Could not save this alert."));
    } finally {
      setAlertSaving(false);
    }
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setAccountError("Supabase authentication is not configured.");
      return;
    }
    setAccountBusy(true);
    setAccountError(null);
    setAccountMessage(null);
    try {
      if (accountMode === "sign_in") {
        const { error } = await supabase.auth.signInWithPassword({
          email: accountEmail.trim(),
          password: accountPassword,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: accountEmail.trim(),
          password: accountPassword,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) {
          setAccountMessage(
            "Account created. Check your email to confirm the account, then sign in here."
          );
        }
      }
    } catch (error) {
      setAccountError(getErrorMessage(error, "Could not authenticate."));
    } finally {
      setAccountBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    setAccountBusy(true);
    setAccountError(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setManagedAlerts([]);
      setEditingAlertId(null);
      setAccountMessage("You have signed out.");
    } catch (error) {
      setAccountError(getErrorMessage(error, "Could not sign out."));
    } finally {
      setAccountBusy(false);
    }
  }

  async function updateAlert(alertId: string, values: AlertForm) {
    if (!session) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const response = await fetch(`/api/alerts/${alertId}`, {
        method: "PATCH",
        headers: {
          ...getAuthorization(session),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...values, maxArticles: Number(values.maxArticles) }),
      });
      await getResponseError(response, "Could not save alert changes.");
      setEditingAlertId(null);
      await loadManagedAlerts(session);
    } catch (error) {
      setEditError(getErrorMessage(error, "Could not save alert changes."));
    } finally {
      setEditSaving(false);
    }
  }

  async function toggleAlert(alert: ManagedAlert) {
    if (!session) return;
    setPendingAlertId(alert.id);
    setManageError(null);
    try {
      const response = await fetch(`/api/alerts/${alert.id}`, {
        method: "PATCH",
        headers: {
          ...getAuthorization(session),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ active: !alert.active }),
      });
      await getResponseError(response, "Could not update this alert.");
      await loadManagedAlerts(session);
    } catch (error) {
      setManageError(getErrorMessage(error, "Could not update this alert."));
    } finally {
      setPendingAlertId(null);
    }
  }

  async function deleteAlert(alert: ManagedAlert) {
    if (!session || !window.confirm(`Delete the alert for “${alert.search_terms}”?`)) return;
    setPendingAlertId(alert.id);
    setManageError(null);
    try {
      const response = await fetch(`/api/alerts/${alert.id}`, {
        method: "DELETE",
        headers: getAuthorization(session),
      });
      await getResponseError(response, "Could not delete this alert.");
      setManagedAlerts((current) => current.filter((item) => item.id !== alert.id));
      if (editingAlertId === alert.id) setEditingAlertId(null);
    } catch (error) {
      setManageError(getErrorMessage(error, "Could not delete this alert."));
    } finally {
      setPendingAlertId(null);
    }
  }

  const openCreate = () => {
    setAlertSaved(false);
    setAlertError(null);
    setModal("create");
  };

  const openManage = () => {
    setManageTab("alerts");
    setManageError(null);
    setAccountError(null);
    setModal("manage");
  };

  function renderAlertFields(
    form: AlertForm,
    setForm: (updater: (current: AlertForm) => AlertForm) => void,
    searchRef?: RefObject<HTMLInputElement>
  ) {
    return (
      <>
        <div>
          <label htmlFor="alert-search-terms" className={labelClass}>Search terms</label>
          <input
            ref={searchRef}
            id="alert-search-terms"
            type="text"
            required
            maxLength={200}
            value={form.searchTerms}
            onChange={(event) => setForm((current) => ({ ...current, searchTerms: event.target.value }))}
            placeholder='term AND term OR "phrase"'
            className={fieldClass}
          />
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Supports AND, OR, quoted phrases, and parentheses.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="alert-timespan" className={labelClass}>Timespan</label>
            <select
              id="alert-timespan"
              value={form.timeSpan}
              onChange={(event) => setForm((current) => ({ ...current, timeSpan: event.target.value }))}
              className={fieldClass}
            >
              <option value="today">Today (UTC)</option>
              <option value="last_3_days">Last 3 days</option>
              <option value="last_week">Last week</option>
            </select>
          </div>
          <div>
            <label htmlFor="alert-frequency" className={labelClass}>Frequency</label>
            <select
              id="alert-frequency"
              value={form.frequency}
              onChange={(event) => setForm((current) => ({ ...current, frequency: event.target.value }))}
              className={fieldClass}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label htmlFor="alert-delivery-time" className={labelClass}>Delivery time (UTC)</label>
            <input
              id="alert-delivery-time"
              type="time"
              required
              value={form.deliveryTimeUtc}
              onChange={(event) => setForm((current) => ({ ...current, deliveryTimeUtc: event.target.value }))}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="alert-max-articles" className={labelClass}>Max number of articles</label>
            <input
              id="alert-max-articles"
              type="number"
              required
              min={1}
              max={MAX_ALERT_ARTICLES}
              step={1}
              value={form.maxArticles}
              onChange={(event) => setForm((current) => ({ ...current, maxArticles: event.target.value }))}
              className={fieldClass}
            />
          </div>
        </div>
        <div>
          <label htmlFor="alert-emails" className={labelClass}>Email addresses</label>
          <textarea
            id="alert-emails"
            required
            rows={2}
            value={form.emails}
            onChange={(event) => setForm((current) => ({ ...current, emails: event.target.value }))}
            placeholder="name@example.com; team@example.com"
            className={`${fieldClass} resize-y`}
          />
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Separate up to 10 addresses with semicolons.
          </p>
        </div>
        <label className="flex items-start gap-2 text-xs leading-5 text-slate-600 dark:text-slate-400">
          <input
            type="checkbox"
            required
            checked={form.consent}
            onChange={(event) => setForm((current) => ({ ...current, consent: event.target.checked }))}
            className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 accent-red-700 focus:ring-red-700 dark:border-slate-600"
          />
          I have permission to send these alerts to the listed recipients.
        </label>
      </>
    );
  }

  function renderAccountPanel() {
    if (session) {
      return (
        <div className="space-y-4">
          <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
            Signed in as <strong>{session.user.email}</strong>.
          </p>
          <button type="button" className={secondaryButtonClass} disabled={accountBusy} onClick={signOut}>
            {accountBusy ? "Signing out..." : "Sign out"}
          </button>
        </div>
      );
    }

    return (
      <form className="space-y-3" onSubmit={saveAccount}>
        <div className="flex gap-2 border-b border-slate-200 pb-2 dark:border-slate-800">
          {(["sign_in", "sign_up"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={accountMode === mode}
              onClick={() => {
                setAccountMode(mode);
                setAccountError(null);
                setAccountMessage(null);
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${accountMode === mode ? "bg-red-700 text-amber-200" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}
            >
              {mode === "sign_in" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="account-email" className={labelClass}>Email</label>
          <input
            id="account-email"
            type="email"
            required
            autoComplete="email"
            value={accountEmail}
            onChange={(event) => setAccountEmail(event.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="account-password" className={labelClass}>Password</label>
          <input
            id="account-password"
            type="password"
            required
            minLength={8}
            autoComplete={accountMode === "sign_in" ? "current-password" : "new-password"}
            value={accountPassword}
            onChange={(event) => setAccountPassword(event.target.value)}
            className={fieldClass}
          />
          {accountMode === "sign_up" && (
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Use at least 8 characters. Supabase may ask you to confirm your email before signing in.
            </p>
          )}
        </div>
        {accountMessage && <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200">{accountMessage}</p>}
        {accountError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{accountError}</p>}
        <button type="submit" className={primaryButtonClass} disabled={accountBusy || sessionLoading}>
          {accountBusy ? "Please wait..." : accountMode === "sign_in" ? "Sign in" : "Create account"}
        </button>
      </form>
    );
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        <button
          ref={alertButtonRef}
          type="button"
          onClick={openCreate}
          className="rounded-lg border border-amber-400 bg-red-700 px-3 py-2 text-sm font-semibold text-amber-200 shadow-sm transition-colors hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:ring-offset-2 dark:border-amber-500 dark:bg-red-800 dark:hover:bg-red-700"
        >
          Alerts
        </button>
        <button
          ref={manageButtonRef}
          type="button"
          onClick={openManage}
          className={secondaryButtonClass}
        >
          Manage
        </button>
      </div>

      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-5"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !alertSaving &&
              !editSaving &&
              !accountBusy
            ) {
              setModal(null);
            }
          }}
        >
          <section
            aria-labelledby="alert-modal-title"
            aria-modal="true"
            className={`max-h-[92vh] w-full overflow-y-auto rounded-xl border border-amber-400 bg-white p-4 shadow-2xl dark:border-amber-600 dark:bg-slate-900 sm:p-5 ${modal === "manage" ? "max-w-2xl" : "max-w-lg"}`}
            role="dialog"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="alert-modal-title" className="text-lg font-semibold text-slate-950 dark:text-white">
                  {modal === "create" ? "Email alerts" : "Manage alerts"}
                </h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {modal === "create"
                    ? "Get archive matches delivered to your inbox."
                    : "View, edit, pause, or delete your alert subscriptions."}
                </p>
              </div>
              <button
                ref={modalCloseRef}
                type="button"
                aria-label="Close"
                onClick={() => setModal(null)}
                className="rounded-md px-2 py-1 text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-700 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                ×
              </button>
            </div>

            {modal === "create" && (
              sessionLoading ? (
                <p role="status" className="text-sm text-slate-600 dark:text-slate-400">Checking account…</p>
              ) : !session ? (
                <div className="space-y-3">
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    Sign in to an account before creating alerts. Your account lets you manage these subscriptions later.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setManageTab("account");
                      setModal("manage");
                    }}
                    className={primaryButtonClass}
                  >
                    Sign in or create account
                  </button>
                </div>
              ) : alertSaved ? (
                <div>
                  <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
                    Alert saved. You can edit it later from Manage. No confirmation emails are sent to alert recipients.
                  </p>
                  <button type="button" onClick={() => setModal(null)} className={`${primaryButtonClass} mt-4`}>Done</button>
                </div>
              ) : (
                <form className="space-y-3" onSubmit={saveAlert}>
                  {renderAlertFields(alertForm, setAlertForm, alertSearchRef)}
                  {alertError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{alertError}</p>}
                  <div className="flex justify-end gap-2 pt-1">
                    <button type="button" onClick={() => setModal(null)} className={secondaryButtonClass}>Cancel</button>
                    <button type="submit" disabled={alertSaving} className={primaryButtonClass}>
                      {alertSaving ? "Saving..." : "Save alert"}
                    </button>
                  </div>
                </form>
              )
            )}

            {modal === "manage" && (
              <div>
                <div role="tablist" aria-label="Manage alerts sections" className="mb-4 flex gap-2 border-b border-slate-200 dark:border-slate-800">
                  {(["alerts", "account"] as const).map((tab) => (
                    <button
                      key={tab}
                      id={`manage-tab-${tab}`}
                      type="button"
                      role="tab"
                      aria-selected={manageTab === tab}
                      aria-controls={`manage-panel-${tab}`}
                      onClick={() => {
                        setManageTab(tab);
                        setManageError(null);
                      }}
                      className={`border-b-2 px-3 py-2 text-sm font-medium ${manageTab === tab ? "border-red-700 text-red-800 dark:text-red-300" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"}`}
                    >
                      {tab === "alerts" ? "Alerts" : "Account"}
                    </button>
                  ))}
                </div>
                <div
                  id={`manage-panel-${manageTab}`}
                  role="tabpanel"
                  aria-labelledby={`manage-tab-${manageTab}`}
                >
                  {manageTab === "account" ? (
                    renderAccountPanel()
                  ) : sessionLoading ? (
                    <p role="status" className="text-sm text-slate-600 dark:text-slate-400">Checking account…</p>
                  ) : !session ? (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        Sign in to view and manage alerts. Create an account if you don’t have one yet.
                      </p>
                      {renderAccountPanel()}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          Signed in as {session.user.email}
                        </p>
                        <button
                          type="button"
                          className={`${secondaryButtonClass} px-2 py-1 text-xs`}
                          disabled={accountBusy}
                          onClick={signOut}
                        >
                          Sign out
                        </button>
                      </div>
                      {manageError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{manageError}</p>}
                      {alertsLoading ? (
                        <p role="status" className="text-sm text-slate-600 dark:text-slate-400">Loading alerts…</p>
                      ) : managedAlerts.length === 0 ? (
                        <p className="rounded-lg border border-slate-200 p-4 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
                          You don’t have any alerts yet. Use the Alerts button to create one.
                        </p>
                      ) : (
                        <ul className="space-y-3">
                          {managedAlerts.map((alert) => (
                            <li key={alert.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="break-words text-sm font-semibold text-slate-950 dark:text-white">{alert.search_terms}</p>
                                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                                    {alert.time_span === "today" ? "Today (UTC)" : alert.time_span === "last_3_days" ? "Last 3 days" : "Last week"} · {alert.frequency} · {alert.delivery_time_utc.slice(0, 5)} UTC · Max {alert.max_articles} articles
                                  </p>
                                  <p className="mt-1 break-all text-xs text-slate-500 dark:text-slate-400">{alert.emails.join("; ")}</p>
                                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                    {alert.active ? "Next delivery: " : "Paused · scheduled for: "}{formatDelivery(alert.next_delivery_at)}
                                  </p>
                                </div>
                                <div className="flex shrink-0 flex-wrap gap-1.5">
                                  <button
                                    type="button"
                                    disabled={pendingAlertId === alert.id}
                                    onClick={() => {
                                      setEditingAlertId(alert.id);
                                      setEditForm(alertToForm(alert));
                                      setEditError(null);
                                    }}
                                    className={`${secondaryButtonClass} px-2 py-1 text-xs`}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    disabled={pendingAlertId === alert.id}
                                    onClick={() => void toggleAlert(alert)}
                                    className={`${secondaryButtonClass} px-2 py-1 text-xs`}
                                  >
                                    {pendingAlertId === alert.id ? "Working…" : alert.active ? "Pause" : "Resume"}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={pendingAlertId === alert.id}
                                    onClick={() => void deleteAlert(alert)}
                                    className="rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                              {editingAlertId === alert.id && (
                                <form
                                  className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800"
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    void updateAlert(alert.id, editForm);
                                  }}
                                >
                                  {renderAlertFields(editForm, setEditForm)}
                                  {editError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{editError}</p>}
                                  <div className="flex justify-end gap-2">
                                    <button type="button" className={secondaryButtonClass} onClick={() => setEditingAlertId(null)}>Cancel</button>
                                    <button type="submit" className={primaryButtonClass} disabled={editSaving}>
                                      {editSaving ? "Saving…" : "Save changes"}
                                    </button>
                                  </div>
                                </form>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
