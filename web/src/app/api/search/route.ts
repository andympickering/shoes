import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();
  const source = searchParams.get("source") || null;
  const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 50);

  if (!query) {
    return NextResponse.json(
      { error: "Missing search query (q parameter)" },
      { status: 400 }
    );
  }

  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY." },
      { status: 503 }
    );
  }

  try {
    // Try PGroonga RPC first
    const { data, error } = await supabase.rpc("search_articles", {
      search_query: query,
      filter_source: source,
      result_limit: limit,
    });

    if (error) {
      // Fallback: ilike search if RPC not available
      let q = supabase
        .from("chnscraping_articles")
        .select("id, source, headline, story_text, url, display_date")
        .order("display_date", { ascending: false })
        .limit(limit);
      if (source) {
        q = q.eq("source", source);
      }
      const pattern = `*${query}*`; // * = % in PostgREST
      q = q.or(`headline.ilike.${pattern},story_text.ilike.${pattern}`);
      const fallback = await q;
      if (fallback.error) {
        return NextResponse.json(
          { error: fallback.error.message },
          { status: 500 }
        );
      }
      const results = fallback.data.map((r) => ({
        ...r,
        snippet: r.story_text?.slice(0, 200),
      }));
      return NextResponse.json({ results });
    }

    return NextResponse.json({ results: data || [] });
  } catch (err) {
    console.error("Search error:", err);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
