"""Discover People's Daily article URLs from its RSS feed."""
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests
from dotenv import load_dotenv
from pathlib import Path


FEED_URL = "https://plink.anyfeeder.com/people-daily"
SOURCE = "people"
TABLE = "chnscraping_discovery_records"
BATCH_SIZE = 50
TRACKING_PARAMETERS = {"fbclid", "gclid", "dclid", "mc_cid", "mc_eid"}
ALLOWED_ARTICLE_DOMAINS = ("people.cn", "people.com.cn")

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
                    "job_type": "daily",
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

        duplicate_count = len(items) - inserted_count
        supabase.request(
            "PATCH",
            "chnscraping_crawl_jobs",
            params={"id": f"eq.{job}"},
            payload={
                "status": "completed",
                "discovered_count": len(items),
                "extracted_count": 0,
                "duplicate_count": duplicate_count,
                "failed_count": 0,
                "completed_at": utc_now(),
                "updated_at": utc_now(),
            },
            prefer="return=minimal",
        )
        print(
            f"RSS discovery complete: {len(items)} unique feed URLs, "
            f"{inserted_count} new discovery records, {duplicate_count} already known."
        )
        return 0
    except Exception as error:
        if supabase is not None and job is not None:
            try:
                supabase.request(
                    "PATCH",
                    "chnscraping_crawl_jobs",
                    params={"id": f"eq.{job}"},
                    payload={
                        "status": "partial" if inserted_count else "failed",
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
