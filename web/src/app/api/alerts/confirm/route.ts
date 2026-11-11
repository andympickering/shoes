import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:Arial,sans-serif;max-width:640px;margin:12vh auto;padding:24px;color:#0f172a"><h1 style="color:#991b1b">${title}</h1>${body}<p><a href="/" style="color:#991b1b">Return to the archive</a></p></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }
  );
}

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || !uuidPattern.test(token)) {
    return page("Invalid confirmation link", "<p>This confirmation link is invalid.</p>", 400);
  }
  return page(
    "Confirm your alert",
    `<p>Click below to confirm that you want to receive this email alert.</p><form method="post" action="/api/alerts/confirm"><input type="hidden" name="token" value="${token}"><button type="submit">Confirm alert</button></form>`
  );
}

export async function POST(request: NextRequest) {
  if (!supabaseAdmin || !process.env.SUPABASE_SERVICE_KEY) {
    return page("Alerts unavailable", "<p>The alert service is not configured.</p>", 503);
  }
  let token: FormDataEntryValue | null;
  try {
    token = (await request.formData()).get("token");
  } catch {
    return page("Invalid confirmation link", "<p>This confirmation link is invalid.</p>", 400);
  }
  if (typeof token !== "string" || !uuidPattern.test(token)) {
    return page("Invalid confirmation link", "<p>This confirmation link is invalid.</p>", 400);
  }
  const { data, error } = await supabaseAdmin
    .from("chnscraping_alert_recipients")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("confirmation_token", token)
    .is("confirmed_at", null)
    .select("subscription_id")
    .maybeSingle();
  if (error) {
    console.error("Could not confirm alert recipient:", error);
    return page("Could not confirm alert", "<p>Please try again later.</p>", 500);
  }
  if (!data) {
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("chnscraping_alert_recipients")
      .select("subscription_id")
      .eq("confirmation_token", token)
      .maybeSingle();
    if (lookupError) {
      console.error("Could not check alert confirmation:", lookupError);
      return page("Could not confirm alert", "<p>Please try again later.</p>", 500);
    }
    if (!existing) return page("Invalid confirmation link", "<p>This link is invalid or the recipient was removed.</p>", 404);
  }
  return page("Alert confirmed", "<p>You have confirmed that you want to receive this alert.</p>");
}
