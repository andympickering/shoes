import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY." },
      { status: 503 }
    );
  }

  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(params.id)) {
    return NextResponse.json({ error: "Invalid article ID." }, { status: 400 });
  }

  try {
    const { data, error } = await supabase
      .from("chnscraping_articles")
      .select("id, source, headline, story_text, url")
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
