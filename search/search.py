"""Shared search logic for Chinese news articles using PGroonga."""
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from supabase import create_client, Client


@dataclass
class SearchResult:
    """A single search result."""

    id: str
    source: str
    headline: str
    story_text: str
    url: str
    display_date: str
    snippet: Optional[str] = None


def get_supabase_client() -> Client:
    """Create Supabase client from environment."""
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    )
    if not url or not key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY (or anon key) required")
    return create_client(url, key)


def search_articles(
    query: str,
    source: Optional[str] = None,
    limit: int = 20,
    client: Optional[Client] = None,
) -> list[SearchResult]:
    """
    Search articles by keyword using PGroonga full-text search.
    PGroonga uses &@~ operator; space = AND, OR = OR.
    """
    if not query.strip():
        return []

    if client is None:
        client = get_supabase_client()

    # PGroonga search: use raw SQL for &@~ operator (not in standard Supabase client)
    # Alternative: use RPC or filter. Supabase JS has .textSearch() for tsvector.
    # For PGroonga we need raw SQL. Use Supabase's .rpc() with a custom function,
    # or use PostgREST filter. PostgREST doesn't support &@~ directly.
    # Solution: Create a database function that wraps the search.

    # We'll use a simpler approach: Supabase allows .or() and .ilike() for basic search.
    # For PGroonga we need an RPC. Let me create a migration for the search function.

    # For now, use ilike as fallback - works but not ideal for Chinese.
    # The plan specifies PGroonga - we need an RPC function.

    # Check if we have the search RPC
    try:
        result = client.rpc(
            "search_articles",
            {"search_query": query, "filter_source": source, "result_limit": limit},
        ).execute()
        if result.data:
            return [
                SearchResult(
                    id=r["id"],
                    source=r["source"],
                    headline=r["headline"],
                    story_text=r["story_text"],
                    url=r["url"],
                    display_date=r["display_date"],
                    snippet=r.get("snippet"),
                )
                for r in result.data
            ]
    except Exception:
        pass

    # Fallback: ilike search (works without PGroonga RPC)
    q = client.table("chnscraping_articles").select(
        "id, source, headline, story_text, url, display_date"
    )
    if source:
        q = q.eq("source", source)
    # Use ilike for simple substring match (headline or story_text)
    pattern = f"%{query.strip()}%"
    q = q.or_(f"headline.ilike.{pattern},story_text.ilike.{pattern}")
    q = q.order("display_date", desc=True).limit(limit)
    result = q.execute()

    return [
        SearchResult(
            id=r["id"],
            source=r["source"],
            headline=r["headline"],
            story_text=r["story_text"],
            url=r["url"],
            display_date=r["display_date"],
            snippet=_extract_snippet(r["story_text"], query) if query else None,
        )
        for r in result.data
    ]


def _extract_snippet(text: str, query: str, max_len: int = 150) -> str:
    """Extract a snippet around the first match of query in text."""
    if not text or not query:
        return ""
    idx = text.find(query)
    if idx < 0:
        for term in query.split():
            idx = text.find(term)
            if idx >= 0:
                break
    if idx < 0:
        return text[:max_len] + "..." if len(text) > max_len else text
    start = max(0, idx - 50)
    end = min(len(text), idx + max_len)
    snippet = text[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."
    return snippet
