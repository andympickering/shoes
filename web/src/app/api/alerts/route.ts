import { createHmac } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseArticleSearch } from "@/lib/article-search";
import {
  getFirstAlertDelivery,
  type AlertFrequency,
} from "@/lib/alert-schedule";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const timeSpans = ["today", "last_3_days", "last_week"] as const;
const frequencies = ["daily", "weekly", "monthly"] as const;
const emailPattern = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function getEmailAddresses(value: unknown) {
  if (typeof value !== "string") return null;
  const emails = value
    .split(";")
    .map((email) => email.trim())
    .filter(Boolean);
  const uniqueEmails = Array.from(
    new Map(emails.map((email) => [email.toLowerCase(), email])).values()
  );
  if (
    uniqueEmails.length < 1 ||
    uniqueEmails.length > 10 ||
    uniqueEmails.some((email) => email.length > 254 || !emailPattern.test(email))
  ) {
    return null;
  }
  return uniqueEmails;
}

export async function POST(request: NextRequest) {
  if (!supabaseAdmin || !process.env.SUPABASE_SERVICE_KEY) {
    return NextResponse.json(
      { error: "Alert subscriptions are not configured on the server." },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsedBody: unknown = await request.json();
    if (typeof parsedBody !== "object" || parsedBody === null || Array.isArray(parsedBody)) {
      return NextResponse.json({ error: "Invalid alert details." }, { status: 400 });
    }
    body = parsedBody as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  const searchTerms =
    typeof body.searchTerms === "string" ? body.searchTerms.trim() : "";
  if (!searchTerms || searchTerms.length > 200) {
    return NextResponse.json(
      { error: "Search terms must be between 1 and 200 characters." },
      { status: 400 }
    );
  }
  try {
    parseArticleSearch(searchTerms);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid search expression." },
      { status: 400 }
    );
  }

  const timeSpan = body.timeSpan;
  if (typeof timeSpan !== "string" || !timeSpans.includes(timeSpan as (typeof timeSpans)[number])) {
    return NextResponse.json({ error: "Choose a valid alert timespan." }, { status: 400 });
  }

  const frequency = body.frequency;
  if (
    typeof frequency !== "string" ||
    !frequencies.includes(frequency as (typeof frequencies)[number])
  ) {
    return NextResponse.json({ error: "Choose a valid delivery frequency." }, { status: 400 });
  }

  const deliveryTimeUtc =
    typeof body.deliveryTimeUtc === "string" ? body.deliveryTimeUtc : "";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(deliveryTimeUtc)) {
    return NextResponse.json({ error: "Enter a valid UTC delivery time." }, { status: 400 });
  }

  if (body.consent !== true) {
    return NextResponse.json(
      { error: "Confirm that the listed recipients agreed to receive alerts." },
      { status: 400 }
    );
  }

  const emails = getEmailAddresses(body.emails);
  if (!emails) {
    return NextResponse.json(
      { error: "Enter 1 to 10 valid email addresses, separated by semicolons." },
      { status: 400 }
    );
  }

  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const requestAddress =
    request.headers.get("x-nf-client-connection-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";
  const requestHash = createHmac("sha256", serviceKey)
    .update(requestAddress)
    .digest("hex");
  const { nextDeliveryAt, scheduleDay } = getFirstAlertDelivery(
    deliveryTimeUtc,
    frequency as AlertFrequency
  );

  const { data, error } = await supabaseAdmin.rpc(
    "chnscraping_create_alert_subscription",
    {
      p_request_hash: requestHash,
      p_search_terms: searchTerms,
      p_time_span: timeSpan,
      p_frequency: frequency,
      p_delivery_time_utc: deliveryTimeUtc,
      p_schedule_day: scheduleDay,
      p_emails: emails,
      p_next_delivery_at: nextDeliveryAt.toISOString(),
    }
  );
  if (error) {
    if (error.code === "P0001") {
      return NextResponse.json(
        { error: "Too many alerts were created from this network. Try again in an hour." },
        { status: 429 }
      );
    }
    console.error("Alert subscription creation failed:", error);
    return NextResponse.json(
      { error: "Could not save this alert. Please try again later." },
      { status: 500 }
    );
  }

  return NextResponse.json({ subscriptionId: data }, { status: 201 });
}
