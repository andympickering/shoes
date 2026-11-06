"""CLI for searching Chinese news articles."""
import argparse
import json
import os
import sys

# Add parent to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from search.search import search_articles


def main() -> int:
    """Run the search CLI."""
    parser = argparse.ArgumentParser(
        description="Search Chinese news articles by keyword",
        epilog='Example: python -m search_cli "经济" --source xinhua --limit 10',
    )
    parser.add_argument(
        "query",
        type=str,
        help="Search keywords (Chinese or English)",
    )
    parser.add_argument(
        "--source",
        type=str,
        default=None,
        help="Filter by source (e.g., xinhua, people)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        help="Maximum number of results (default: 10)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON",
    )
    args = parser.parse_args()

    try:
        results = search_articles(
            query=args.query,
            source=args.source,
            limit=args.limit,
        )
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Search failed: {e}", file=sys.stderr)
        return 1

    if args.json:
        output = [
            {
                "id": r.id,
                "source": r.source,
                "headline": r.headline,
                "url": r.url,
                "display_date": r.display_date,
                "snippet": r.snippet or r.story_text[:200],
            }
            for r in results
        ]
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0

    if not results:
        print("No results found.")
        return 0

    for i, r in enumerate(results, 1):
        date_str = r.display_date[:10] if r.display_date else "N/A"
        print(f"\n{i}. [{r.source}] {r.headline}")
        print(f"   {r.url}")
        print(f"   Date: {date_str}")
        if r.snippet:
            print(f"   {r.snippet[:120]}...")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
