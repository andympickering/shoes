import { createHmac } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAlertUserId } from "@/lib/alert-auth";
import { getFirstAlertDelivery } from "@/lib/alert-schedule";
import { validateAlertSettings } from "@/lib/alert-validation";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Alert subscriptions are not configured." }, { status: 503 });
  }
  const userId = await getAlertUserId(request);
  if (!userId) return NextResponse.json({ error: "Sign in to manage alerts." }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("chnscraping_alert_subscriptions")
    .select(
      "id, search_terms, time_span, frequency, delivery_time_utc, emails, active, next_delivery_at, last_sent_at, created_at"
    )
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Could not load alert subscriptions:", error);
    return NextResponse.json({ error: "Could not load your alerts." }, { status: 500 });
  }

  return NextResponse.json({ alerts: data });
}

export async function POST(request: NextRequest) {
  if (!supabaseAdmin || !process.env.SUPABASE_SERVICE_KEY) {
    return NextResponse.json(
      { error: "Alert subscriptions are not configured on the server." },
      { status: 503 }
    );
  }
  const userId = await getAlertUserId(request);
  if (!userId) return NextResponse.json({ error: "Sign in to save alerts." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }
  const validated = validateAlertSettings(body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const settings = validated.settings;

  const requestAddress =
    request.headers.get("x-nf-client-connection-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";
  const requestHash = createHmac("sha256", process.env.SUPABASE_SERVICE_KEY)
    .update(requestAddress)
    .digest("hex");
  const { nextDeliveryAt, scheduleDay } = getFirstAlertDelivery(
    settings.deliveryTimeUtc,
    settings.frequency
  );

  const { data, error } = await supabaseAdmin.rpc(
    "chnscraping_create_alert_subscription",
    {
      p_request_hash: requestHash,
      p_search_terms: settings.searchTerms,
      p_time_span: settings.timeSpan,
      p_frequency: settings.frequency,
      p_delivery_time_utc: settings.deliveryTimeUtc,
      p_schedule_day: scheduleDay,
      p_emails: settings.emails,
      p_next_delivery_at: nextDeliveryAt.toISOString(),
      p_owner_user_id: userId,
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
