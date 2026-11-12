import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase server access is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY." },
      { status: 503 }
    );
  }

  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(params.id)) {
    return NextResponse.json({ error: "Invalid article ID." }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("chnscraping_articles")
      .select("id, source, headline, story_text, url, published_at")
      .eq("id", params.id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Article not found." }, { status: 404 });
    }

    return NextResponse.json({ article: data });
  } catch (error) {
    console.error("Article detail error:", error);
    return NextResponse.json({ error: "Could not load article." }, { status: 500 });
  }
}
