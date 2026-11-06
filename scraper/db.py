"""Supabase database operations for the scraper."""
from datetime import datetime
from typing import Any, Optional

from supabase import create_client, Client

from .config import Config


def get_client(config: Config) -> Client:
    """Create and return a Supabase client."""
    return create_client(config.supabase_url, config.supabase_service_key)


def insert_article(
    client: Client,
    source: str,
    headline: str,
    story_text: str,
    url: str,
    published_at: Optional[datetime] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> dict[str, Any] | None:
    """
    Insert an article into the database.
    Uses upsert on url to handle deduplication - skips if url already exists.
    Returns the inserted/updated row or None on conflict.
    """
    scraped_at = datetime.utcnow().isoformat()
    published_at_str = published_at.isoformat() if published_at else None

    row = {
        "source": source,
        "headline": headline,
        "story_text": story_text,
        "url": url,
        "published_at": published_at_str,
        "scraped_at": scraped_at,
        "metadata": metadata or {},
    }

    result = client.table("chnscraping_articles").upsert(
        row,
        on_conflict="url",
        ignore_duplicates=True,
    ).execute()

    # When ignore_duplicates=True, no row is returned on conflict
    if result.data and len(result.data) > 0:
        return result.data[0]
    return None
