import { NextRequest, NextResponse } from "next/server";
import { getAlertUserId } from "@/lib/alert-auth";
import { getFirstAlertDelivery } from "@/lib/alert-schedule";
import { validateAlertSettings } from "@/lib/alert-validation";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Alert subscriptions are not configured." }, { status: 503 });
  }
  const userId = await getAlertUserId(request);
  if (!userId) return NextResponse.json({ error: "Sign in to edit alerts." }, { status: 401 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) {
    return NextResponse.json({ error: "Alert not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }
  if (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    typeof (body as Record<string, unknown>).active === "boolean" &&
    Object.keys(body).length === 1
  ) {
    const { data, error } = await supabaseAdmin
      .from("chnscraping_alert_subscriptions")
      .update({ active: (body as { active: boolean }).active, lock_expires_at: null })
      .eq("id", params.id)
      .eq("owner_user_id", userId)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("Could not update alert status:", error);
      return NextResponse.json({ error: "Could not update this alert." }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Alert not found." }, { status: 404 });
    return NextResponse.json({ updated: true });
  }

  const validated = validateAlertSettings(body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const settings = validated.settings;
  const { nextDeliveryAt, scheduleDay } = getFirstAlertDelivery(
    settings.deliveryTimeUtc,
    settings.frequency
  );
  const { data, error } = await supabaseAdmin
    .from("chnscraping_alert_subscriptions")
    .update({
      search_terms: settings.searchTerms,
      time_span: settings.timeSpan,
      frequency: settings.frequency,
      delivery_time_utc: settings.deliveryTimeUtc,
      max_articles: settings.maxArticles,
      schedule_day: scheduleDay,
      emails: settings.emails,
      next_delivery_at: nextDeliveryAt.toISOString(),
      lock_expires_at: null,
    })
    .eq("id", params.id)
    .eq("owner_user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("Could not edit alert:", error);
    return NextResponse.json({ error: "Could not save alert changes." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Alert not found." }, { status: 404 });
  return NextResponse.json({ updated: true });
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Alert subscriptions are not configured." }, { status: 503 });
  }
  const userId = await getAlertUserId(request);
  if (!userId) return NextResponse.json({ error: "Sign in to delete alerts." }, { status: 401 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) {
    return NextResponse.json({ error: "Alert not found." }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("chnscraping_alert_subscriptions")
    .delete()
    .eq("id", params.id)
    .eq("owner_user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("Could not delete alert:", error);
    return NextResponse.json({ error: "Could not delete this alert." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Alert not found." }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
