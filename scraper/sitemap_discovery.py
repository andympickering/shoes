"""Discover People's Daily article URLs from its publisher sitemaps."""
import sys
import time
import xml.etree.ElementTree as ET
from urllib.parse import urljoin, urlsplit

import requests
from dotenv import load_dotenv
from pathlib import Path

from .rss_discovery import (
    ALLOWED_ARTICLE_DOMAINS,
    BATCH_SIZE,
    SOURCE,
    TABLE,
    SupabaseRest,
    normalize_url,
    utc_now,
)


ROBOTS_URL = "https://www.people.com.cn/robots.txt"
DEFAULT_CRAWL_DELAY_SECONDS = 120.0
MAX_DOCUMENT_BYTES = 50 * 1024 * 1024
MAX_SITEMAP_DOCUMENTS = 500
MAX_REDIRECTS = 5
REQUEST_TIMEOUT = (15, 60)
USER_AGENT = "CHNscraping sitemap discovery; contact repository owner"

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)


class SitemapFetchError(RuntimeError):
    def __init__(self, message: str, last_request_at: float | None):
        super().__init__(message)
        self.last_request_at = last_request_at


def _allowed_url(url: str) -> bool:
    try:
        parts = urlsplit(url)
        hostname = parts.hostname
    except ValueError:
        return False
    if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
        return False
    if parts.username or parts.password:
        return False
    host = hostname.lower()
    return any(
        host == domain or host.endswith("." + domain)
        for domain in ALLOWED_ARTICLE_DOMAINS
    )


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def parse_sitemap_xml(content: bytes) -> tuple[str, list[str]]:
    """Return the sitemap document type and its referenced URLs."""
    root = ET.fromstring(content)
    root_name = _local_name(root.tag)
    if root_name == "sitemapindex":
        entry_name = "sitemap"
        document_type = "index"
    elif root_name == "urlset":
        entry_name = "url"
        document_type = "urlset"
    else:
        raise ValueError(f"Unsupported sitemap root element: {root_name}")

    urls: list[str] = []
    for entry in root:
        if _local_name(entry.tag) != entry_name:
            continue
        location = next(
            (child.text.strip() for child in entry if _local_name(child.tag) == "loc" and child.text),
            "",
        )
        if location:
            urls.append(location)
    return document_type, urls


def parse_robots_txt(content: str) -> tuple[list[str], float]:
    """Return allowed sitemap locations and the publisher's crawl delay."""
    sitemap_urls: list[str] = []
    crawl_delay = DEFAULT_CRAWL_DELAY_SECONDS
    active_user_agents: list[str] = []
    group_has_directive = False

    for raw_line in content.splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        name, value = (part.strip() for part in line.split(":", 1))
        name = name.lower()

        if name == "user-agent":
            if group_has_directive:
                active_user_agents = []
                group_has_directive = False
            active_user_agents.append(value.lower())
            continue

        group_has_directive = True
        if name == "sitemap" and _allowed_url(value):
            sitemap_urls.append(value)
        elif name == "crawl-delay" and "*" in active_user_agents:
            try:
                parsed_delay = float(value)
            except ValueError:
                continue
            if parsed_delay >= 0:
                crawl_delay = parsed_delay

    if not sitemap_urls:
        raise ValueError("robots.txt did not advertise an allowed sitemap")
    return list(dict.fromkeys(sitemap_urls)), crawl_delay


def _wait_for_crawl_delay(delay_seconds: float, last_request_at: float | None) -> None:
    if last_request_at is None:
        return
    remaining = delay_seconds - (time.monotonic() - last_request_at)
    if remaining > 0:
        time.sleep(remaining)


def fetch_document(
    session: requests.Session,
    url: str,
    delay_seconds: float,
    last_request_at: float | None,
) -> tuple[bytes, float]:
    """Fetch one XML/text document without bypassing the site's crawl delay."""
    current_url = url
    redirects = 0

    while True:
        if not _allowed_url(current_url):
            raise ValueError(f"Refusing URL outside People's Daily domains: {current_url}")

        _wait_for_crawl_delay(delay_seconds, last_request_at)
        request_started_at = time.monotonic()
        try:
            response = session.get(
                current_url,
                headers={"User-Agent": USER_AGENT},
                timeout=REQUEST_TIMEOUT,
                allow_redirects=False,
            )
        except requests.RequestException as error:
            raise SitemapFetchError(
                f"Request failed while fetching {current_url}: {error}",
                request_started_at,
            ) from error
        last_request_at = time.monotonic()

        if response.is_redirect or response.is_permanent_redirect:
            redirects += 1
            if redirects > MAX_REDIRECTS:
                raise SitemapFetchError(
                    f"Too many redirects while fetching {url}",
                    last_request_at,
                )
            location = response.headers.get("Location")
            if not location:
                raise SitemapFetchError(
                    f"Redirect from {current_url} did not include a location",
                    last_request_at,
                )
            current_url = urljoin(current_url, location)
            continue

        if not response.ok:
            raise SitemapFetchError(
                f"HTTP {response.status_code} while fetching {current_url}",
                last_request_at,
            )
        if len(response.content) > MAX_DOCUMENT_BYTES:
            raise SitemapFetchError(
                f"Sitemap document exceeded 50 MiB: {current_url}",
                last_request_at,
            )
        return response.content, last_request_at


def read_sitemap_urls(
    session: requests.Session,
) -> tuple[dict[str, tuple[str, str]], list[str]]:
    """Map normalized article URLs to original URLs and their sitemap provenance."""
    robots_content, last_request_at = fetch_document(
        session,
        ROBOTS_URL,
        0,
        None,
    )
    sitemap_urls, crawl_delay = parse_robots_txt(robots_content.decode("utf-8", errors="replace"))

    article_urls: dict[str, tuple[str, str]] = {}
    errors: list[str] = []
    visited_sitemaps: set[str] = set()
    pending_sitemaps = list(sitemap_urls)

    while pending_sitemaps:
        sitemap_url = pending_sitemaps.pop(0)
        normalized_sitemap_url = normalize_url(sitemap_url)
        if not normalized_sitemap_url or normalized_sitemap_url in visited_sitemaps:
            continue
        visited_sitemaps.add(normalized_sitemap_url)
        if len(visited_sitemaps) > MAX_SITEMAP_DOCUMENTS:
            errors.append(
                f"Sitemap index exceeded the {MAX_SITEMAP_DOCUMENTS}-document safety limit"
            )
            break

        try:
            content, last_request_at = fetch_document(
                session,
                sitemap_url,
                crawl_delay,
                last_request_at,
            )
            document_type, urls = parse_sitemap_xml(content)
        except (SitemapFetchError, ValueError, ET.ParseError) as error:
            if isinstance(error, SitemapFetchError):
                last_request_at = error.last_request_at
            message = f"{sitemap_url}: {error}"
            errors.append(message)
            print(f"Sitemap fetch failed: {message}", file=sys.stderr)
            continue

        if document_type == "index":
            for url in urls:
                if _allowed_url(url):
                    pending_sitemaps.append(url)
                else:
                    message = f"Refusing sitemap URL outside People's Daily domains: {url}"
                    errors.append(message)
                    print(message, file=sys.stderr)
            continue

        for article_url in urls:
            normalized_url = normalize_url(article_url)
            if normalized_url:
                article_urls.setdefault(normalized_url, (article_url, sitemap_url))

    return article_urls, errors


def main() -> int:
    job = None
    supabase = None
    inserted_count = 0
    failed_count = 0

    try:
        supabase = SupabaseRest()
        timestamp = utc_now()
        job_rows = supabase.request(
            "POST",
            "chnscraping_crawl_jobs",
            payload=[
                {
                    "source": SOURCE,
                    "job_type": "weekly",
                    "status": "running",
                    "started_at": timestamp,
                }
            ],
            params={"select": "id"},
            prefer="return=representation",
        )
        if not job_rows or not job_rows[0].get("id"):
            raise RuntimeError("Supabase did not return the crawl job ID")
        job = job_rows[0]["id"]

        with requests.Session() as session:
            article_sitemaps, sitemap_errors = read_sitemap_urls(session)

        normalized_urls = list(article_sitemaps)
        existing = supabase.find_existing(normalized_urls)
        records = [
            {
                "crawl_job_id": job,
                "source": SOURCE,
                "discovered_url": article_sitemaps[normalized_url][0],
                "normalized_url": normalized_url,
                "discovered_from_url": article_sitemaps[normalized_url][1],
                "discovery_method": "sitemap",
                "processing_status": "pending",
                "discovered_at": timestamp,
                "last_seen_at": timestamp,
            }
            for normalized_url in normalized_urls
            if normalized_url not in existing
        ]

        for start in range(0, len(records), BATCH_SIZE):
            inserted = supabase.request(
                "POST",
                TABLE,
                params={"on_conflict": "source,normalized_url,discovery_method"},
                payload=records[start : start + BATCH_SIZE],
                prefer="resolution=ignore-duplicates,return=representation",
            )
            inserted_count += len(inserted)

        duplicate_count = len(normalized_urls) - inserted_count
        failed_count = len(sitemap_errors)
        job_status = "partial" if sitemap_errors else "completed"
        supabase.request(
            "PATCH",
            "chnscraping_crawl_jobs",
            params={"id": f"eq.{job}"},
            payload={
                "status": job_status,
                "discovered_count": len(normalized_urls),
                "extracted_count": 0,
                "duplicate_count": duplicate_count,
                "failed_count": failed_count,
                "error_summary": "\n".join(sitemap_errors)[:1000] or None,
                "completed_at": utc_now(),
                "updated_at": utc_now(),
            },
            prefer="return=minimal",
        )
        print(
            f"Sitemap discovery {job_status}: {len(normalized_urls)} unique article URLs, "
            f"{inserted_count} new discovery records, {duplicate_count} already known, "
            f"{failed_count} sitemap errors."
        )
        return 1 if sitemap_errors else 0
    except Exception as error:
        failed_count = 1
        if supabase is not None and job is not None:
            try:
                supabase.request(
                    "PATCH",
                    "chnscraping_crawl_jobs",
                    params={"id": f"eq.{job}"},
                    payload={
                        "status": "failed",
                        "error_summary": str(error)[:1000],
                        "failed_count": failed_count,
                        "completed_at": utc_now(),
                        "updated_at": utc_now(),
                    },
                    prefer="return=minimal",
                )
            except Exception as update_error:
                print(f"Could not update failed crawl job: {update_error}", file=sys.stderr)
        print(f"Sitemap discovery failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
