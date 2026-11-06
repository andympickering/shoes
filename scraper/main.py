"""Main entry point for the Chinese news scraper."""
import argparse
import sys
from pathlib import Path

# Load .env from project root
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

from .config import Config
from .db import get_client, insert_article
from .adapters import BjnewsAdapter, CaixinAdapter, PeopleAdapter


def main() -> int:
    """Run all scrapers and store results in Supabase."""
    parser = argparse.ArgumentParser(description="Scrape Chinese news sites")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch articles but do not insert into database",
    )
    args = parser.parse_args()

    if not args.dry_run:
        try:
            config = Config.from_env()
        except ValueError as e:
            print(f"Configuration error: {e}", file=sys.stderr)
            return 1
        client = get_client(config)
    else:
        config = None
        client = None

    delay = config.request_delay_seconds if config else 3.0
    adapters = [
        PeopleAdapter(delay_seconds=delay),
        CaixinAdapter(delay_seconds=delay),
        BjnewsAdapter(delay_seconds=delay),
    ]

    total_inserted = 0
    for adapter in adapters:
        print(f"Scraping {adapter.source_id}...")
        try:
            articles = adapter.fetch_articles()
            print(f"  Found {len(articles)} articles")
            for article in articles:
                if args.dry_run:
                    print(f"    [dry-run] {article.headline[:50]}...")
                    total_inserted += 1
                else:
                    result = insert_article(
                        client,
                        source=adapter.source_id,
                        headline=article.headline,
                        story_text=article.story_text,
                        url=article.url,
                        published_at=article.published_at,
                        metadata=article.metadata,
                    )
                    if result:
                        total_inserted += 1
        except Exception as e:
            print(f"  Error: {e}", file=sys.stderr)

    print(f"Done. {'Would insert' if args.dry_run else 'Inserted'} {total_inserted} new articles.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
