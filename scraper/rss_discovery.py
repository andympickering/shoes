"""Discover People's Daily article URLs from its RSS feed."""
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import requests
from dotenv import load_dotenv
from pathlib import Path

from .adapters.base import Article
from .adapters.people import PeopleAdapter


FEED_URL = "https://plink.anyfeeder.com/people-daily"
SOURCE = "people"
TABLE = "chnscraping_discovery_records"
ARTICLES_TABLE = "chnscraping_articles"
BATCH_SIZE = 50
TRACKING_PARAMETERS = {"fbclid", "gclid", "dclid", "mc_cid", "mc_eid"}
ALLOWED_ARTICLE_DOMAINS = ("people.cn", "people.com.cn")
ARTICLE_USER_AGENT = PeopleAdapter.USER_AGENT
DEFAULT_CRAWL_DELAY_SECONDS = 3.0

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_url(url: str) -> str | None:
    parts = urlsplit(url.strip())
    if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
        return None

    host = parts.hostname.lower()
    if not any(host == domain or host.endswith("." + domain) for domain in ALLOWED_ARTICLE_DOMAINS):
        return None

    port = parts.port
    netloc = host
    if port and (parts.scheme.lower(), port) not in (("http", 80), ("https", 443)):
        netloc = f"{host}:{port}"

    query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and key.lower() not in TRACKING_PARAMETERS
    ]
    return urlunsplit((parts.scheme.lower(), netloc, parts.path or "/", urlencode(query), ""))


def alternate_people_domain_url(url: str) -> str | None:
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    hostname = parts.hostname
    if not hostname or parts.username or parts.password:
        return None

    host = hostname.lower()
    if host == "people.com.cn" or host.endswith(".people.com.cn"):
        alternate_host = host[: -len("people.com.cn")] + "people.cn"
    elif host == "people.cn" or host.endswith(".people.cn"):
        alternate_host = host[: -len("people.cn")] + "people.com.cn"
    else:
        return None

    scheme = "https" if parts.scheme.lower() == "http" else parts.scheme
    try:
        port = parts.port
    except ValueError:
        return None
    if scheme == "https" and port == 80:
        port = None
    netloc = alternate_host if port is None else f"{alternate_host}:{port}"
    return urlunsplit((scheme, netloc, parts.path, parts.query, parts.fragment))


def get_text(element: ET.Element, name: str) -> str:
    for child in element:
        if child.tag.rsplit("}", 1)[-1].lower() == name:
            return (child.text or "").strip()
    return ""


class SupabaseRest:
    def __init__(self) -> None:
        import os

        self.base_url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
        self.key = os.environ.get("SUPABASE_SERVICE_KEY", "")
        if not self.base_url or not self.key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be configured")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Accept": "application/json",
            }
        )

    def request(self, method: str, table: str, *, params=None, payload=None, prefer=None):
        headers = {}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if prefer:
            headers["Prefer"] = prefer
        response = self.session.request(
            method,
            f"{self.base_url}/rest/v1/{table}",
            params=params,
            json=payload,
            headers=headers,
            timeout=(15, 60),
        )
        if not response.ok:
            raise RuntimeError(
                f"Supabase {method} {table} failed ({response.status_code}): "
                f"{response.text[:1000]}"
            )
        if not response.content:
            return []
        return response.json()

    @staticmethod
    def in_filter(values: list[str]) -> str:
        quoted = [
            '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
            for value in values
        ]
        return "in.(" + ",".join(quoted) + ")"

    def find_existing(self, normalized_urls: list[str]) -> set[str]:
        existing: set[str] = set()
        for start in range(0, len(normalized_urls), BATCH_SIZE):
            batch = normalized_urls[start : start + BATCH_SIZE]
            rows = self.request(
                "GET",
                TABLE,
                params={
                    "select": "normalized_url",
                    "source": f"eq.{SOURCE}",
                    "normalized_url": self.in_filter(batch),
                    "limit": str(BATCH_SIZE),
                },
            )
            existing.update(row["normalized_url"] for row in rows)
        return existing

    def find_pending(self, normalized_urls: list[str]) -> list[dict[str, Any]]:
        pending: list[dict[str, Any]] = []
        for start in range(0, len(normalized_urls), BATCH_SIZE):
            batch = normalized_urls[start : start + BATCH_SIZE]
            pending.extend(
                self.request(
                    "GET",
                    TABLE,
                    params={
                        "select": "id,discovered_url,normalized_url,attempts",
                        "source": f"eq.{SOURCE}",
                        "discovery_method": "eq.rss",
                        "normalized_url": self.in_filter(batch),
                        "processing_status": "in.(pending,processing,failed)",
                        "attempts": "lt.3",
                        "limit": str(BATCH_SIZE),
                    },
                )
            )
        return pending

    def find_pending_records(self, limit: int) -> list[dict[str, Any]]:
        return self.request(
            "GET",
            TABLE,
            params={
                "select": "id,discovered_url,normalized_url,attempts,discovery_method",
                "source": f"eq.{SOURCE}",
                "discovery_method": "eq.sitemap",
                "processing_status": "in.(pending,processing,failed)",
                "attempts": "lt.3",
                "order": "discovered_at.asc",
                "limit": str(limit),
            },
        )


@dataclass
class ProcessStats:
    extracted: int = 0
    duplicates: int = 0
    failed: int = 0
    restricted: int = 0
    errors: list[str] = field(default_factory=list)


def read_robots_policy(
    session: requests.Session, article_url: str
) -> tuple[RobotFileParser, float]:
    parts = urlsplit(article_url)
    robots_url = urlunsplit((parts.scheme, parts.netloc, "/robots.txt", "", ""))
    response = session.get(
        robots_url,
        headers={"User-Agent": ARTICLE_USER_AGENT},
        timeout=(15, 60),
    )
    if response.status_code == 404:
        lines: list[str] = []
    else:
        response.raise_for_status()
        if len(response.content) > 1024 * 1024:
            raise RuntimeError(f"robots.txt exceeded the 1 MiB safety limit: {robots_url}")
        lines = response.text.splitlines()

    parser = RobotFileParser(robots_url)
    parser.parse(lines)
    delay = parser.crawl_delay(ARTICLE_USER_AGENT)
    return parser, float(delay if delay is not None else DEFAULT_CRAWL_DELAY_SECONDS)


def wait_for_crawl_delay(delay_seconds: float, last_request_at: float | None) -> None:
    if last_request_at is None:
        return
    remaining = delay_seconds - (time.monotonic() - last_request_at)
    if remaining > 0:
        time.sleep(remaining)


def update_discovery_record(supabase: SupabaseRest, record_id: str, **fields: Any) -> None:
    fields["updated_at"] = utc_now()
    supabase.request(
        "PATCH",
        TABLE,
        params={"id": f"eq.{record_id}"},
        payload=fields,
        prefer="return=minimal",
    )


def save_article(
    supabase: SupabaseRest,
    article: Article,
    discovery_method: str = "rss",
) -> tuple[str, str]:
    payload = {
        "source": SOURCE,
        "headline": article.headline,
        "story_text": article.story_text,
        "url": article.url,
        "published_at": article.published_at.isoformat() if article.published_at else None,
        "scraped_at": utc_now(),
        "metadata": {"discovery_method": discovery_method},
    }
    inserted = supabase.request(
        "POST",
        ARTICLES_TABLE,
        params={"on_conflict": "url"},
        payload=[payload],
        prefer="resolution=ignore-duplicates,return=representation",
    )
    if inserted:
        return "processed", inserted[0]["id"]

    existing = supabase.request(
        "GET",
        ARTICLES_TABLE,
        params={"select": "id", "url": f"eq.{article.url}", "limit": "1"},
    )
    if not existing:
        raise RuntimeError("Article upsert returned no row and no existing article was found")
    return "duplicate", existing[0]["id"]


def process_discoveries(
    supabase: SupabaseRest,
    records: list[dict[str, Any]],
    adapter: PeopleAdapter,
    robots_session: requests.Session | None = None,
    on_record_complete: Callable[[dict[str, Any], ProcessStats], None] | None = None,
) -> ProcessStats:
    stats = ProcessStats()
    policies: dict[str, tuple[RobotFileParser, float]] = {}
    last_request_by_origin: dict[str, float] = {}
    owns_session = robots_session is None
    session = robots_session or requests.Session()

    try:
        for record in records:
            record_id = record["id"]
            article_url = record["discovered_url"]

            try:
                update_discovery_record(
                    supabase,
                    record_id,
                    processing_status="processing",
                    attempts=record.get("attempts", 0) + 1,
                    last_attempt_at=utc_now(),
                    error_message=None,
                )
                alternate_url = alternate_people_domain_url(article_url)
                candidate_urls = [article_url]
                if alternate_url and alternate_url != article_url:
                    candidate_urls.append(alternate_url)

                article = None
                successful_url = article_url
                errors: list[str] = []
                original_restricted = False

                for candidate_url in candidate_urls:
                    if candidate_url != article_url:
                        print(
                            f"Retrying article on alternate hostname: {candidate_url}",
                            file=sys.stderr,
                        )
                    origin = urlsplit(candidate_url)
                    origin_key = f"{origin.scheme}://{origin.netloc}"

                    try:
                        if origin_key not in policies:
                            policies[origin_key] = read_robots_policy(session, candidate_url)
                            last_request_by_origin[origin_key] = time.monotonic()
                        robots, delay_seconds = policies[origin_key]
                    except requests.RequestException as error:
                        errors.append(f"{candidate_url}: {error}")
                        continue

                    if not robots.can_fetch(ARTICLE_USER_AGENT, candidate_url):
                        if candidate_url == article_url:
                            original_restricted = True
                            break
                        errors.append(f"{candidate_url}: robots.txt disallows this article URL")
                        continue

                    wait_for_crawl_delay(delay_seconds, last_request_by_origin[origin_key])
                    last_request_by_origin[origin_key] = time.monotonic()
                    try:
                        candidate_article = adapter._parse_article(candidate_url)
                    except requests.RequestException as error:
                        errors.append(f"{candidate_url}: {error}")
                        continue

                    if (
                        candidate_article is None
                        or not candidate_article.headline.strip()
                        or not candidate_article.story_text.strip()
                        or candidate_article.story_text.strip() == candidate_article.headline.strip()
                    ):
                        errors.append(
                            f"{candidate_url}: Article adapter did not extract both a headline and body"
                        )
                        continue

                    article = candidate_article
                    successful_url = candidate_url
                    break

                if original_restricted:
                    update_discovery_record(
                        supabase,
                        record_id,
                        processing_status="restricted",
                        error_message="robots.txt disallows this article URL",
                    )
                    stats.restricted += 1
                    continue

                if article is None:
                    message = "All supported hostnames failed: " + " | ".join(errors)
                    update_discovery_record(
                        supabase,
                        record_id,
                        processing_status="failed",
                        error_message=message,
                    )
                    stats.failed += 1
                    stats.errors.append(f"{article_url}: {message}")
                    continue

                article.url = successful_url
                status, article_id = save_article(
                    supabase,
                    article,
                    record.get("discovery_method", "rss"),
                )
                update_discovery_record(
                    supabase,
                    record_id,
                    processing_status=status,
                    article_id=article_id,
                    error_message=None,
                )
                if status == "processed":
                    stats.extracted += 1
                else:
                    stats.duplicates += 1
            except Exception as error:
                message = str(error)[:1000]
                try:
                    update_discovery_record(
                        supabase,
                        record_id,
                        processing_status="failed",
                        error_message=message,
                    )
                except Exception as update_error:
                    print(
                        f"Could not update failed discovery record {record_id}: {update_error}",
                        file=sys.stderr,
                    )
                stats.failed += 1
                stats.errors.append(f"{article_url}: {message}")
                print(f"Article extraction failed for {article_url}: {message}", file=sys.stderr)
            finally:
                if on_record_complete is not None:
                    on_record_complete(record, stats)
    finally:
        if owns_session:
            session.close()

    return stats


def read_feed() -> list[tuple[str, str]]:
    response = requests.get(
        FEED_URL,
        headers={"User-Agent": "CHNscraping URL discovery; contact repository owner"},
        timeout=(15, 60),
    )
    response.raise_for_status()
    if len(response.content) > 10 * 1024 * 1024:
        raise RuntimeError("RSS feed exceeded the 10 MiB safety limit")

    root = ET.fromstring(response.content)
    if root.tag.rsplit("}", 1)[-1].lower() != "rss":
        raise RuntimeError("RSS response did not contain an RSS document")

    articles: dict[str, str] = {}
    for item in root.iter():
        if item.tag.rsplit("}", 1)[-1].lower() != "item":
            continue
        article_url = get_text(item, "link")
        normalized = normalize_url(article_url)
        if normalized:
            articles.setdefault(normalized, article_url)
    return list(articles.items())


def main() -> int:
    job = None
    supabase = None
    inserted_count = 0
    processed_count = 0
    try:
        supabase = SupabaseRest()
        items = read_feed()
        timestamp = utc_now()

        job_rows = supabase.request(
            "POST",
            "chnscraping_crawl_jobs",
            payload=[
                {
                    "source": SOURCE,
                    "job_type": "hourly",
                    "crawl_type": "discovery",
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

        urls = [normalized for normalized, _ in items]
        existing = supabase.find_existing(urls)
        records = [
            {
                "crawl_job_id": job,
                "source": SOURCE,
                "discovered_url": original,
                "normalized_url": normalized,
                "discovered_from_url": FEED_URL,
                "discovery_method": "rss",
                "processing_status": "pending",
                "discovered_at": timestamp,
                "last_seen_at": timestamp,
            }
            for normalized, original in items
            if normalized not in existing
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

        records_to_process = supabase.find_pending(urls)
        adapter = PeopleAdapter(delay_seconds=0, user_agent=ARTICLE_USER_AGENT)
        stats = process_discoveries(supabase, records_to_process, adapter)
        processed_count = stats.extracted
        duplicate_count = len(items) - inserted_count + stats.duplicates
        job_status = "partial" if stats.failed or stats.restricted else "completed"
        supabase.request(
            "PATCH",
            "chnscraping_crawl_jobs",
            params={"id": f"eq.{job}"},
            payload={
                "status": job_status,
                "discovered_count": len(items),
                "extracted_count": stats.extracted,
                "duplicate_count": duplicate_count,
                "failed_count": stats.failed,
                "restricted_count": stats.restricted,
                "error_summary": "\n".join(stats.errors)[:1000] or None,
                "completed_at": utc_now(),
                "updated_at": utc_now(),
            },
            prefer="return=minimal",
        )
        print(
            f"RSS discovery {job_status}: {len(items)} unique feed URLs, "
            f"{inserted_count} new discovery records, {stats.extracted} articles saved, "
            f"{duplicate_count} duplicates, {stats.failed} failed, "
            f"{stats.restricted} restricted."
        )
        return 1 if stats.failed or stats.restricted else 0
    except Exception as error:
        if supabase is not None and job is not None:
            try:
                supabase.request(
                    "PATCH",
                    "chnscraping_crawl_jobs",
                    params={"id": f"eq.{job}"},
                    payload={
                        "status": "partial" if inserted_count else "failed",
                        "extracted_count": processed_count,
                        "failed_count": max(1, inserted_count - processed_count),
                        "error_summary": str(error)[:1000],
                        "completed_at": utc_now(),
                        "updated_at": utc_now(),
                    },
                    prefer="return=minimal",
                )
            except Exception as update_error:
                print(f"Could not update failed crawl job: {update_error}", file=sys.stderr)
        print(f"RSS discovery failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
