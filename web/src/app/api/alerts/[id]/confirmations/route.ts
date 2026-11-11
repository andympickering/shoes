import { NextRequest, NextResponse } from "next/server";
import { getAlertUserId } from "@/lib/alert-auth";
import { sendPendingConfirmations } from "@/lib/alert-confirmation";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Alert subscriptions are not configured." }, { status: 503 });
  const userId = await getAlertUserId(request);
  if (!userId) return NextResponse.json({ error: "Sign in to manage alerts." }, { status: 401 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) {
    return NextResponse.json({ error: "Alert not found." }, { status: 404 });
  }
  const { data, error } = await supabaseAdmin
    .from("chnscraping_alert_subscriptions")
    .select("id")
    .eq("id", params.id)
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("Could not load alert:", error);
    return NextResponse.json({ error: "Could not load this alert." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Alert not found." }, { status: 404 });
  try {
    const failed = await sendPendingConfirmations(params.id, userId);
    if (failed.length) {
      return NextResponse.json(
        { error: "Some confirmation emails could not be sent. Please wait and try again later." },
        { status: 502 }
      );
    }
    return NextResponse.json({ sent: true });
  } catch (confirmationError) {
    console.error("Could not resend alert confirmations:", confirmationError);
    return NextResponse.json({ error: "Could not send confirmation emails. Please try again later." }, { status: 500 });
  }
}
