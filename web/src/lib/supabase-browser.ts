"use client";

import { createBrowserClient } from "@supabase/ssr";
import { createClient, isAuthRetryableFetchError } from "@supabase/supabase-js";
import { getSafeRedirectPath } from "@/lib/auth-redirect";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let authLink = (() => {
  if (typeof window === "undefined") return null;

  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const type = fragment.get("type");
  if (
    type !== "invite" &&
    type !== "recovery" &&
    !(fragment.has("error_code") && fragment.has("error_description"))
  ) {
    return null;
  }

  const tokens = {
    access_token: fragment.get("access_token"),
    refresh_token: fragment.get("refresh_token"),
  };
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`
  );
  return tokens;
})();

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createBrowserClient(supabaseUrl, supabaseAnonKey)
    : null;

export async function sendPasswordSetupEmail(email: string) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase authentication is not configured.");
  }

  const recoveryClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { error } = await recoveryClient.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/`,
  });
  if (error) throw error;
}

let authLinkPromise: Promise<boolean> | undefined;

export function handleAuthLink(): Promise<boolean> {
  if (authLinkPromise) return authLinkPromise;
  if (!authLink) return Promise.resolve(false);
  const pendingLink = authLink;
  authLink = null;

  authLinkPromise = (async () => {
    if (!supabase) {
      window.location.replace("/login?error=auth-unavailable");
      return true;
    }

    if (!pendingLink.access_token || !pendingLink.refresh_token) {
      window.location.replace("/login?error=invalid-link");
      return true;
    }

    try {
      const { data, error } = await supabase.auth.setSession({
        access_token: pendingLink.access_token,
        refresh_token: pendingLink.refresh_token,
      });
      if (error || !data.session) {
        if (error) console.error("Could not establish an invited session:", error.message);
        const reason = error && (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500)
          ? "auth-unavailable"
          : "invalid-link";
        window.location.replace(`/login?error=${reason}`);
        return true;
      }

      const next = getSafeRedirectPath(
        new URLSearchParams(window.location.search).get("next"),
        window.location.origin
      );
      window.location.replace(`/set-password?next=${encodeURIComponent(next)}`);
    } catch (error) {
      console.error("Could not establish an invited session:", error);
      window.location.replace("/login?error=auth-unavailable");
    }
    return true;
  })();

  return authLinkPromise;
}
