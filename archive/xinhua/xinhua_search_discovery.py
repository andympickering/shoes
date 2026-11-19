"""Discover Xinhua URLs from active alert search terms."""
import sys
import time
from datetime import datetime, timedelta, timezone

import requests
from dotenv import load_dotenv
from pathlib import Path

from .alert_search import active_alert_terms, alert_terms
from .rss_discovery import BATCH_SIZE, TABLE, SupabaseRest, normalize_url, utc_now
from .sitemap_discovery import _allowed_url


SOURCE = "xinhua"
SEARCH_URL = "https://so.news.cn/getNews"
ARTICLE_DOMAINS = ("news.cn", "xinhuanet.com")
SEARCH_DELAY_SECONDS = 3.0
MAX_PAGES = 1000
BEIJING = timezone(timedelta(hours=8))

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)


def search_term(
    session: requests.Session,
    term: str,
    start: datetime,
    end: datetime,
    articles: dict[str, str],
    last_request_at: float | None,
) -> float | None:
    """Collect results in newest-first order; fail if coverage is uncertain."""
    previous_date = None
    page = 1
    while page <= MAX_PAGES:
        if last_request_at is not None:
            remaining = SEARCH_DELAY_SECONDS - (time.monotonic() - last_request_at)
            if remaining > 0:
                time.sleep(remaining)
        try:
            response = session.get(
                SEARCH_URL,
                params={
                    "keyword": term,
                    "curPage": page,
                    "sortField": 0,
                    "searchFields": 0,
                    "lang": "cn",
                },
                timeout=(15, 60),
                allow_redirects=False,
            )
            last_request_at = time.monotonic()
            if response.status_code != 200:
                raise RuntimeError(f"Xinhua search returned HTTP {response.status_code}")
            data = response.json()
        except requests.RequestException as error:
            raise RuntimeError(f"Xinhua search request failed: {type(error).__name__}") from error
        if not isinstance(data, dict) or data.get("code") != 200 or not isinstance(data.get("content"), dict):
            raise ValueError("Invalid Xinhua search response")
        content = data["content"]
        results = content.get("results")
        page_count = content.get("pageCount")
        if (
            not isinstance(results, list)
            or not isinstance(page_count, int)
            or isinstance(page_count, bool)
            or page_count < 0
            or content.get("curPage") != page
        ):
            raise ValueError("Invalid Xinhua search pagination")
        if not results and page < page_count:
            raise ValueError("Xinhua search returned an empty intermediate page")

        older = False
        for item in results:
            if not isinstance(item, dict) or not isinstance(item.get("pubtime"), str):
                raise ValueError("Xinhua search result is missing its publication time")
            try:
                published = datetime.strptime(item["pubtime"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=BEIJING)
            except ValueError as error:
                raise ValueError("Invalid Xinhua search publication time") from error
            if previous_date is not None and published > previous_date:
                raise ValueError("Xinhua search results are not ordered by publication time")
            previous_date = published
            if published < start:
                older = True
                continue
            if published > end:
                continue
            url = item.get("url")
            if not isinstance(url, str) or not _allowed_url(url, ARTICLE_DOMAINS):
                raise ValueError("Xinhua search returned a URL outside allowed article domains")
            if url.split("?", 1)[0].lower().endswith((".htm", ".html")):
                normalized = normalize_url(url, ARTICLE_DOMAINS)
                if normalized:
                    articles.setdefault(normalized, url)
        if older:
            return last_request_at
        if page >= page_count:
            if page_count >= MAX_PAGES and results:
                raise RuntimeError("Xinhua search reached its result limit before the 24-hour boundary")
            return last_request_at
        page += 1
    raise RuntimeError("Xinhua search exceeded the page safety limit")


def main() -> int:
    supabase = None
    job = None
    try:
        supabase = SupabaseRest()
        started = datetime.now(timezone.utc)
        timestamp = started.isoformat()
        jobs = supabase.request(
            "POST",
            "chnscraping_crawl_jobs",
            payload=[{
                "source": SOURCE, "job_type": "daily", "crawl_type": "discovery",
                "status": "running", "started_at": timestamp,
            }],
            params={"select": "id"},
            prefer="return=representation",
        )
        if not jobs or not jobs[0].get("id"):
            raise RuntimeError("Supabase did not return the crawl job ID")
        job = jobs[0]["id"]
        terms = active_alert_terms(supabase)
        articles: dict[str, str] = {}
        errors: list[str] = []
        last_request_at = None
        with requests.Session() as session:
            session.headers.update({"User-Agent": "CHNscraping search discovery; contact repository owner"})
            for index, term in enumerate(terms, 1):
                try:
                    last_request_at = search_term(
                        session, term, started - timedelta(days=1), started, articles, last_request_at
                    )
                except (ValueError, RuntimeError) as error:
                    last_request_at = time.monotonic()
                    errors.append(f"Search {index}: {error}")
                    print(errors[-1], file=sys.stderr)

        existing = supabase.find_existing(list(articles), SOURCE)
        records = [
            {
                "crawl_job_id": job, "source": SOURCE, "discovered_url": url,
                "normalized_url": normalized, "discovered_from_url": SEARCH_URL,
                "discovery_method": "search", "processing_status": "pending",
                "discovered_at": timestamp, "last_seen_at": timestamp,
            }
            for normalized, url in articles.items() if normalized not in existing
        ]
        inserted_count = 0
        for start in range(0, len(records), BATCH_SIZE):
            inserted = supabase.request(
                "POST", TABLE,
                params={"on_conflict": "source,normalized_url,discovery_method"},
                payload=records[start:start + BATCH_SIZE],
                prefer="resolution=ignore-duplicates,return=representation",
            )
            inserted_count += len(inserted)
        status = "partial" if errors else "completed"
        supabase.request(
            "PATCH", "chnscraping_crawl_jobs",
            params={"id": f"eq.{job}"},
            payload={
                "status": status, "discovered_count": len(articles),
                "duplicate_count": len(articles) - inserted_count,
                "failed_count": len(errors), "error_summary": "\n".join(errors)[:1000] or None,
                "completed_at": utc_now(), "updated_at": utc_now(),
            },
            prefer="return=minimal",
        )
        print(f"Xinhua discovery {status}: {len(articles)} URLs, {inserted_count} new, {len(errors)} search errors.")
        return 1 if errors else 0
    except Exception as error:
        if supabase is not None and job is not None:
            try:
                supabase.request(
                    "PATCH", "chnscraping_crawl_jobs",
                    params={"id": f"eq.{job}"},
                    payload={
                        "status": "failed", "failed_count": 1, "error_summary": str(error)[:1000],
                        "completed_at": utc_now(), "updated_at": utc_now(),
                    },
                    prefer="return=minimal",
                )
            except Exception as update_error:
                print(f"Could not update failed crawl job: {update_error}", file=sys.stderr)
        print(f"Xinhua discovery failed: {error}", file=sys.stderr)
        return 1
    finally:
        if supabase is not None:
            supabase.session.close()


if __name__ == "__main__":
    sys.exit(main())
