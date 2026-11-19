"""Discover Cankaoxiaoxi URLs from active alert search terms."""
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

import requests
from dotenv import load_dotenv

from .alert_search import active_alert_terms
from .rss_discovery import BATCH_SIZE, TABLE, SupabaseRest, normalize_url, utc_now
from .sitemap_discovery import _allowed_url


SOURCE = "cankaoxiaoxi"
SEARCH_URL = "https://ckxxapp.ckxx.net/contentapi/api/content/getChannelAllContents"
SEARCH_REFERER = "https://www.cankaoxiaoxi.com/statics/ckxx-website/index.html"
CHANNEL_ID = "d0b20aa58694484c83508e65c0c9a582"
SITE_ID = "2b0cbbb1d563414393513f147f7e9799"
ARTICLE_DOMAINS = ("ckxxapp.ckxx.net",)
SEARCH_DELAY_SECONDS = 3.0
PAGE_SIZE = 10
MAX_PAGES = 1000
BEIJING = timezone(timedelta(hours=8))

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)


def _client_app_id() -> str:
    """Match the public site's per-client `pc-` identifier format."""
    return f"pc-{uuid.uuid4().hex}"


def search_term(
    session: requests.Session,
    term: str,
    start: datetime,
    end: datetime,
    articles: dict[str, str],
    app_id: str,
    last_request_at: float | None,
) -> float | None:
    """Collect newest-first search results until the rolling-window boundary."""
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
                    "channelId": CHANNEL_ID,
                    "pageNum": page,
                    "keyword": term,
                    "pageSize": PAGE_SIZE,
                    "appId": app_id,
                    "siteId": SITE_ID,
                },
                timeout=(15, 60),
                allow_redirects=False,
            )
            last_request_at = time.monotonic()
            if response.status_code != 200:
                raise RuntimeError(
                    f"Cankaoxiaoxi search returned HTTP {response.status_code}"
                )
            data = response.json()
        except requests.RequestException as error:
            raise RuntimeError(
                f"Cankaoxiaoxi search request failed: {type(error).__name__}"
            ) from error
        if not isinstance(data, dict) or str(data.get("status")) != "200":
            raise ValueError("Invalid Cankaoxiaoxi search response")
        results = data.get("list")
        page_count = data.get("pages")
        if (
            not isinstance(results, list)
            or not isinstance(page_count, int)
            or isinstance(page_count, bool)
            or page_count < 0
            or (page > page_count and results)
        ):
            raise ValueError("Invalid Cankaoxiaoxi search pagination")
        if not results and page < page_count:
            raise ValueError("Cankaoxiaoxi search returned an empty intermediate page")

        older = False
        for item in results:
            if not isinstance(item, dict) or not isinstance(item.get("data"), dict):
                raise ValueError("Cankaoxiaoxi search result is missing article data")
            article_data = item["data"]
            published_text = article_data.get("publishTime")
            if not isinstance(published_text, str):
                raise ValueError("Cankaoxiaoxi search result is missing its publication time")
            try:
                published = datetime.strptime(
                    published_text, "%Y-%m-%d %H:%M:%S"
                ).replace(tzinfo=BEIJING)
            except ValueError as error:
                raise ValueError(
                    "Invalid Cankaoxiaoxi search publication time"
                ) from error
            if previous_date is not None and published > previous_date:
                raise ValueError(
                    "Cankaoxiaoxi search results are not ordered by publication time"
                )
            previous_date = published
            if published < start:
                older = True
                continue
            if published > end:
                continue

            url = article_data.get("url")
            if (
                not isinstance(url, str)
                or not _allowed_url(url, ARTICLE_DOMAINS)
                or not urlsplit(url).path.lower().endswith(".html")
            ):
                raise ValueError(
                    "Cankaoxiaoxi search returned a URL outside allowed article pages"
                )
            normalized = normalize_url(url, ARTICLE_DOMAINS)
            if normalized:
                articles.setdefault(normalized, url)

        if older:
            return last_request_at
        if page >= page_count:
            if page_count >= MAX_PAGES and results:
                raise RuntimeError(
                    "Cankaoxiaoxi search reached its result limit before the 48-hour boundary"
                )
            return last_request_at
        page += 1
    raise RuntimeError("Cankaoxiaoxi search exceeded the page safety limit")


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
                "source": SOURCE,
                "job_type": "daily",
                "crawl_type": "discovery",
                "status": "running",
                "started_at": timestamp,
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
            session.headers.update({
                "User-Agent": "CHNscraping search discovery; contact repository owner",
                "Referer": SEARCH_REFERER,
                "X-Requested-With": "XMLHttpRequest",
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json, text/plain, */*",
            })
            app_id = _client_app_id()
            for index, term in enumerate(terms, 1):
                try:
                    last_request_at = search_term(
                        session,
                        term,
                        started - timedelta(days=2),
                        started,
                        articles,
                        app_id,
                        last_request_at,
                    )
                except (ValueError, RuntimeError) as error:
                    last_request_at = time.monotonic()
                    errors.append(f"Search {index}: {error}")
                    print(errors[-1], file=sys.stderr)

        existing = supabase.find_existing(list(articles), SOURCE)
        records = [
            {
                "crawl_job_id": job,
                "source": SOURCE,
                "discovered_url": url,
                "normalized_url": normalized,
                "discovered_from_url": SEARCH_URL,
                "discovery_method": "search",
                "processing_status": "pending",
                "discovered_at": timestamp,
                "last_seen_at": timestamp,
            }
            for normalized, url in articles.items()
            if normalized not in existing
        ]
        inserted_count = 0
        for batch_start in range(0, len(records), BATCH_SIZE):
            inserted = supabase.request(
                "POST",
                TABLE,
                params={"on_conflict": "source,normalized_url,discovery_method"},
                payload=records[batch_start:batch_start + BATCH_SIZE],
                prefer="resolution=ignore-duplicates,return=representation",
            )
            inserted_count += len(inserted)
        status = "partial" if errors else "completed"
        supabase.request(
            "PATCH",
            "chnscraping_crawl_jobs",
            params={"id": f"eq.{job}"},
            payload={
                "status": status,
                "discovered_count": len(articles),
                "duplicate_count": len(articles) - inserted_count,
                "failed_count": len(errors),
                "error_summary": "\n".join(errors)[:1000] or None,
                "completed_at": utc_now(),
                "updated_at": utc_now(),
            },
            prefer="return=minimal",
        )
        print(
            f"Cankaoxiaoxi discovery {status}: {len(articles)} URLs, "
            f"{inserted_count} new, {len(errors)} search errors."
        )
        return 1 if errors else 0
    except Exception as error:
        if supabase is not None and job is not None:
            try:
                supabase.request(
                    "PATCH",
                    "chnscraping_crawl_jobs",
                    params={"id": f"eq.{job}"},
                    payload={
                        "status": "failed",
                        "failed_count": 1,
                        "error_summary": str(error)[:1000],
                        "completed_at": utc_now(),
                        "updated_at": utc_now(),
                    },
                    prefer="return=minimal",
                )
            except Exception as update_error:
                print(
                    f"Could not update failed crawl job: {update_error}",
                    file=sys.stderr,
                )
        print(f"Cankaoxiaoxi discovery failed: {error}", file=sys.stderr)
        return 1
    finally:
        if supabase is not None:
            supabase.session.close()


if __name__ == "__main__":
    sys.exit(main())
