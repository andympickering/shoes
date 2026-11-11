import { supabaseAdmin } from "@/lib/supabase-admin";

interface ConfirmationRecipient {
  email: string;
  confirmation_token: string;
  search_terms: string;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export async function sendPendingConfirmations(subscriptionId: string, userId: string) {
  const admin = supabaseAdmin;
  if (!admin) throw new Error("Alert subscriptions are not configured.");
  const { data: recipients, error } = await admin
    .from("chnscraping_alert_recipients")
    .select("email")
    .eq("subscription_id", subscriptionId)
    .is("confirmed_at", null);
  if (error) throw new Error(`Could not load pending alert recipients: ${error.message}`);
  const pending: { email: string }[] = recipients ?? [];
  if (pending.length === 0) return [];
  if (!process.env.RESEND_API_KEY || !process.env.ALERTS_FROM_EMAIL) {
    throw new Error("Confirmation email delivery is not configured.");
  }
  let siteUrl: URL;
  try {
    siteUrl = new URL(process.env.ALERTS_SITE_URL ?? "");
    if (siteUrl.protocol !== "https:" || siteUrl.username || siteUrl.password) {
      throw new Error("Invalid site URL.");
    }
  } catch {
    throw new Error("Set ALERTS_SITE_URL to the deployed HTTPS site URL.");
  }

  const claims = await Promise.all(pending.map(async (recipient) => {
    const { data, error: claimError } = await admin.rpc(
      "chnscraping_claim_alert_confirmation",
      {
        p_subscription_id: subscriptionId,
        p_owner_user_id: userId,
        p_email: recipient.email,
      }
    );
    if (claimError) {
      console.error("Could not claim confirmation email:", claimError);
      return { failedEmail: recipient.email };
    }
    const claimed = data?.[0] as ConfirmationRecipient | undefined;
    if (!claimed) {
      return { failedEmail: recipient.email };
    }
    const confirmationUrl = new URL("/api/alerts/confirm", siteUrl);
    confirmationUrl.searchParams.set("token", claimed.confirmation_token);
    const link = confirmationUrl.toString();
    return {
      email: claimed.email,
      message: {
          from: process.env.ALERTS_FROM_EMAIL,
          to: [claimed.email],
          subject: "Confirm your Chinese News Archive alert",
          html: `<p>Someone requested an alert for <strong>${escapeHtml(claimed.search_terms)}</strong>.</p><p><a href="${escapeHtml(link)}">Confirm this alert</a></p><p>If you did not request this alert, you can ignore this email. You will not receive the alert unless you confirm.</p>`,
          text: `Someone requested an alert for "${claimed.search_terms}".\n\nConfirm this alert: ${link}\n\nIf you did not request this alert, you can ignore this email. You will not receive the alert unless you confirm.`,
      },
    };
  }));
  const failed = claims.flatMap((claim) => claim.failedEmail ? [claim.failedEmail] : []);
  const messages = claims.filter((claim) => claim.message !== undefined);
  if (messages.length === 0) return failed;
  try {
    const response = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages.map((claim) => claim.message)),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Resend returned status ${response.status}.`);
  } catch (sendError) {
    console.error("Could not send alert confirmations:", sendError);
    failed.push(...messages.map((claim) => claim.email));
  }
  return failed;
}
