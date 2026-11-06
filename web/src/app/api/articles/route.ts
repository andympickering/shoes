import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { parseArticleSearch, type SearchExpression } from "@/lib/article-search";

const maxPageSize = 100;
const sourceBatchSize = 1000;

export const dynamic = "force-dynamic";

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function GET(request: NextRequest) {
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY." },
      { status: 503 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);

    if (searchParams.get("sources") === "1") {
      const uniqueSources = new Set<string>();
      let offset = 0;

      while (true) {
        const { data, error } = await supabase
          .from("chnscraping_articles")
          .select("source")
          .order("source", { ascending: true })
          .range(offset, offset + sourceBatchSize - 1);

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        for (const row of data) {
          if (row.source) uniqueSources.add(row.source);
        }
        if (data.length < sourceBatchSize) break;
        offset += sourceBatchSize;
      }

      return NextResponse.json({ sources: Array.from(uniqueSources) });
    }

    const requestedPage = Number(searchParams.get("page") || "1");
    const requestedPageSize = Number(searchParams.get("pageSize") || "50");
    if (!Number.isInteger(requestedPage) || requestedPage < 1) {
      return NextResponse.json({ error: "Page must be a positive integer." }, { status: 400 });
    }
    if (
      !Number.isInteger(requestedPageSize) ||
      requestedPageSize < 1 ||
      requestedPageSize > maxPageSize
    ) {
      return NextResponse.json(
        { error: `Page size must be between 1 and ${maxPageSize}.` },
        { status: 400 }
      );
    }

    const publishedFrom = searchParams.get("publishedFrom") || searchParams.get("published") || "";
    const publishedTo = searchParams.get("publishedTo") || "";
    if (
      (publishedFrom && !isValidDate(publishedFrom)) ||
      (publishedTo && !isValidDate(publishedTo))
    ) {
      return NextResponse.json({ error: "Published dates must be valid YYYY-MM-DD dates." }, { status: 400 });
    }
    if (publishedFrom && publishedTo && publishedFrom > publishedTo) {
      return NextResponse.json(
        { error: "Published date range must end on or after its start date." },
        { status: 400 }
      );
    }

    const source = searchParams.get("source");
    const headline = searchParams.get("headline")?.trim() || "";
    const headlineOnly = searchParams.get("headlineOnly") === "true";
    let searchExpression: SearchExpression | null = null;

    if (headline) {
      try {
        searchExpression = parseArticleSearch(headline);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Invalid search expression." },
          { status: 400 }
        );
      }
    }

    const startDate = publishedFrom || publishedTo;
    const endDate = publishedTo || publishedFrom;
    const publishedStart = startDate
      ? new Date(`${startDate}T00:00:00.000Z`).toISOString()
      : null;
    let publishedEndExclusive: string | null = null;
    if (endDate) {
      const end = new Date(`${endDate}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      publishedEndExclusive = end.toISOString();
    }

    const { data, error } = await supabase.rpc("chnscraping_list_articles", {
      search_expression: searchExpression,
      search_headline_only: headlineOnly,
      filter_source: source,
      published_from: publishedStart,
      published_to_exclusive: publishedEndExclusive,
      result_page: requestedPage,
      result_page_size: requestedPageSize,
    });
    if (error) {
      const status = error.code === "2201B" || error.code === "22023" ? 400 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({
      articles: data,
      total: data[0]?.total_count ?? 0,
    });
  } catch (error) {
    console.error("Article list error:", error);
    return NextResponse.json({ error: "Could not load articles." }, { status: 500 });
  }
}
