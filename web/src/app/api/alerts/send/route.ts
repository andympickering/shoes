import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseArticleSearch } from "@/lib/article-search";
import {
  getNextAlertDelivery,
  type AlertFrequency,
} from "@/lib/alert-schedule";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

interface DueAlert {
  subscription_id: string;
  unsubscribe_token: string;
  search_terms: string;
  time_span: "today" | "last_3_days" | "last_week";
  frequency: AlertFrequency;
  schedule_day: number;
  max_articles: number;
  emails: string[];
  next_delivery_at: string;
  lock_expires_at: string;
}

interface AlertArticle {
  id: string;
  source: string;
  headline: string;
  url: string;
  display_date: string;
  total_count: number;
}

type AlertSearchResult = Omit<AlertArticle, "url">;

function isAuthorized(request: NextRequest) {
  const secret = process.env.ALERTS_CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function getLookbackStart(timeSpan: DueAlert["time_span"], now: Date) {
  if (timeSpan === "today") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  const days = timeSpan === "last_3_days" ? 3 : 7;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function getPeriodLabel(timeSpan: DueAlert["time_span"]) {
  if (timeSpan === "today") return "today (UTC)";
  return timeSpan === "last_3_days" ? "the last 3 days" : "the last 7 days";
}

function formatArticleDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function formatEmailDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}-${part("month")}-${part("year")}`;
}

async function sendAlert(alert: DueAlert, now: Date, siteUrl: string) {
  if (!supabaseAdmin) throw new Error("Supabase admin client is not configured.");

  const searchExpression = parseArticleSearch(alert.search_terms);
  const { data, error } = await supabaseAdmin.rpc("chnscraping_list_articles", {
    search_expression: searchExpression,
    search_headline_only: false,
    filter_source: null,
    published_from: getLookbackStart(alert.time_span, now).toISOString(),
    published_to_exclusive: now.toISOString(),
    result_page: 1,
    result_page_size: alert.max_articles,
  });
  if (error) throw new Error(`Article search failed: ${error.message}`);

  const searchResults = (data ?? []) as AlertSearchResult[];
  const totalCount = Number(searchResults[0]?.total_count ?? 0);
  if (totalCount === 0) return false;

  const { data: articleUrls, error: articleUrlsError } = await supabaseAdmin
    .from("chnscraping_articles")
    .select("id, url")
    .in("id", searchResults.map((article) => article.id));
  if (articleUrlsError) {
    throw new Error(`Could not load article source URLs: ${articleUrlsError.message}`);
  }

  const urlByArticleId = new Map(
    (articleUrls ?? []).map((article) => [article.id, article.url])
  );
  const articles: AlertArticle[] = searchResults.map((article) => {
    const url = urlByArticleId.get(article.id);
    if (!url) throw new Error(`Article ${article.id} has no source URL.`);
    const parsedUrl = new URL(url);
    if (
      !["http:", "https:"].includes(parsedUrl.protocol) ||
      parsedUrl.username ||
      parsedUrl.password
    ) {
      throw new Error(`Article ${article.id} has an invalid source URL.`);
    }
    return { ...article, url };
  });

  const unsubscribeUrl = `${siteUrl}/api/alerts/unsubscribe?token=${encodeURIComponent(alert.unsubscribe_token)}`;
  const period = getPeriodLabel(alert.time_span);
  const articleHtml = articles
    .map((article) => {
      const archiveUrl = `${siteUrl}/articles/${encodeURIComponent(article.id)}`;
      return `<li style="margin:0 0 16px"><a href="${escapeHtml(article.url)}" style="color:#b91c1c;font-weight:600">${escapeHtml(article.headline)}</a><br><span style="color:#475569;font-size:13px">${escapeHtml(article.source)} · ${escapeHtml(formatArticleDate(article.display_date))} &nbsp;<a href="${escapeHtml(archiveUrl)}" style="display:inline-block;padding:0 7px;border:1px solid #fbbf24;border-radius:10px;color:#92400e;background:#fffbeb;font-size:11px;line-height:17px;text-decoration:none">Archive ›</a></span></li>`;
    })
    .join("");
  const articleText = articles
    .map(
      (article) =>
        `- ${article.headline} (${article.source}, ${formatArticleDate(article.display_date)})\n  ${article.url}\n  Archive: ${siteUrl}/articles/${encodeURIComponent(article.id)}`
    )
    .join("\n");
  const moreText =
    totalCount > articles.length
      ? `<p>Showing ${articles.length} of ${totalCount} matching articles.</p>`
      : "";
  const morePlainText =
    totalCount > articles.length
      ? `\nShowing ${articles.length} of ${totalCount} matching articles.`
      : "";
  const imageUrl = `${siteUrl}/mao-banner.png`;
  const html = `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#171717;line-height:1.6;max-width:640px;margin:0 auto;background:#f8fafc"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#b91c1c;border-bottom:3px solid #fbbf24"><tr><td style="padding:21px 16px 21px 22px;text-align:left"><h1 style="margin:0;color:#fcd34d;font-family:'Microsoft YaHei','Noto Sans CJK SC',Arial,sans-serif;font-size:39px;line-height:1.3;font-weight:700">来自中国的笔记</h1><p style="margin:5px 0 0;color:#fde68a;font-size:14.3px;font-weight:700;letter-spacing:1px">${formatEmailDate(now)}</p></td><td width="110" align="right" valign="middle" style="padding:8px 18px 8px 0"><img src="${imageUrl}" alt="Portrait of Mao Zedong" width="90" height="108" style="display:block;width:90px;height:108px;object-fit:cover"></td></tr></table><div style="padding:20px 22px;background:#fff"><p>${totalCount} article${totalCount === 1 ? "" : "s"} matched <strong>${escapeHtml(alert.search_terms)}</strong> in ${period}.</p><ul style="padding-left:20px">${articleHtml}</ul>${moreText}<hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0"><p style="font-size:12px;color:#475569">To stop these alerts, <a href="${unsubscribeUrl}" style="color:#b91c1c">unsubscribe here</a>.</p></div></div>`;
  const text = `${totalCount} article${totalCount === 1 ? "" : "s"} matched "${alert.search_terms}" in ${period}.\n\n${articleText}${morePlainText}\n\nUnsubscribe: ${unsubscribeUrl}`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `${alert.subscription_id}-${alert.next_delivery_at}`,
    },
    body: JSON.stringify({
      from: process.env.ALERTS_FROM_EMAIL,
      to: alert.emails,
      subject: `Chinese News Archive: ${totalCount} alert match${totalCount === 1 ? "" : "es"}`,
      html,
      text,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error(`Resend request failed with status ${response.status}.`);
  }
  return true;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (
    !supabaseAdmin ||
    !process.env.SUPABASE_SERVICE_KEY ||
    !process.env.RESEND_API_KEY ||
    !process.env.ALERTS_FROM_EMAIL
  ) {
    return NextResponse.json(
      { error: "Alert delivery is not fully configured on the server." },
      { status: 503 }
    );
  }
  const configuredSiteUrl = process.env.ALERTS_SITE_URL;
  let siteUrl: string;
  try {
    const parsedUrl = new URL(configuredSiteUrl ?? "");
    if (parsedUrl.protocol !== "https:") throw new Error("HTTPS is required.");
    siteUrl = parsedUrl.toString().replace(/\/+$/, "");
  } catch {
    return NextResponse.json(
      { error: "Set ALERTS_SITE_URL to the deployed HTTPS site URL." },
      { status: 503 }
    );
  }

  const { data, error } = await supabaseAdmin.rpc("chnscraping_claim_due_alerts", {
    p_batch_size: 1,
  });
  if (error) {
    console.error("Could not claim due alerts:", error);
    return NextResponse.json({ error: "Could not load due alerts." }, { status: 500 });
  }

  const alert = (data?.[0] ?? null) as DueAlert | null;
  if (!alert) return NextResponse.json({ processed: 0, sent: 0 });

  const now = new Date();
  let sent = false;
  try {
    sent = await sendAlert(alert, now, siteUrl);
  } catch (error) {
    const { error: unlockError } = await supabaseAdmin
      .from("chnscraping_alert_subscriptions")
      .update({ lock_expires_at: null })
      .eq("id", alert.subscription_id)
      .eq("lock_expires_at", alert.lock_expires_at);
    if (unlockError) {
      console.error("Could not release failed alert lock:", unlockError);
    }
    console.error(`Alert delivery failed for ${alert.subscription_id}:`, error);
    return NextResponse.json(
      { error: "Alert delivery failed. The alert will be retried." },
      { status: 502 }
    );
  }

  const nextDelivery = getNextAlertDelivery(
    new Date(alert.next_delivery_at),
    alert.frequency,
    alert.schedule_day,
    now
  );
  const { error: updateError } = await supabaseAdmin
    .from("chnscraping_alert_subscriptions")
    .update({
      next_delivery_at: nextDelivery.toISOString(),
      lock_expires_at: null,
      last_processed_at: now.toISOString(),
      ...(sent ? { last_sent_at: now.toISOString() } : {}),
    })
    .eq("id", alert.subscription_id)
    .eq("lock_expires_at", alert.lock_expires_at);
  if (updateError) {
    console.error(`Could not advance alert ${alert.subscription_id}:`, updateError);
    return NextResponse.json(
      { error: "Alert was processed but its schedule could not be advanced." },
      { status: 500 }
    );
  }

  return NextResponse.json({ processed: 1, sent: sent ? 1 : 0 });
}
