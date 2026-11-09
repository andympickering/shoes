import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function responsePage(title: string, message: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:Arial,sans-serif;max-width:640px;margin:12vh auto;padding:24px;color:#0f172a"><h1 style="color:#991b1b">${title}</h1><p>${message}</p><a href="/" style="color:#991b1b">Return to the archive</a></body></html>`,
    {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    }
  );
}

export async function GET(request: NextRequest) {
  if (!supabaseAdmin || !process.env.SUPABASE_SERVICE_KEY) {
    return responsePage("Alerts unavailable", "The alert service is not configured.", 503);
  }

  const token = new URL(request.url).searchParams.get("token");
  if (!token || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return responsePage("Invalid unsubscribe link", "This alert link is invalid.", 400);
  }

  const { data, error } = await supabaseAdmin
    .from("chnscraping_alert_subscriptions")
    .update({ active: false, lock_expires_at: null })
    .eq("unsubscribe_token", token)
    .eq("active", true)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("Could not unsubscribe alert:", error);
    return responsePage("Could not unsubscribe", "Please try again later.", 500);
  }
  if (!data) {
    return responsePage(
      "Alerts stopped",
      "This alert was already stopped or the link has expired."
    );
  }
  return responsePage("Alerts stopped", "This email alert has been unsubscribed.");
}
