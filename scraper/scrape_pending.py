"""Extract articles from pending publisher sitemap discoveries."""
import argparse
import sys

from dotenv import load_dotenv
from pathlib import Path

from .adapters.bjnews import BjnewsAdapter
from .adapters.people import PeopleAdapter
from .rss_discovery import (
    ARTICLE_USER_AGENT,
    BJNEWS_ARTICLE_USER_AGENT,
    ProcessStats,
    SupabaseRest,
    alternate_people_domain_url,
    process_discoveries,
    utc_now,
)


MAX_RECORDS = 1000
JOBS_TABLE = "chnscraping_crawl_jobs"
SOURCE_ADAPTERS = {
    "people": (PeopleAdapter, ARTICLE_USER_AGENT, alternate_people_domain_url),
    "bjnews": (BjnewsAdapter, BJNEWS_ARTICLE_USER_AGENT, None),
}

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)


def main(source: str = "people") -> int:
    job = None
    supabase = None
    try:
        try:
            adapter_type, user_agent, alternate_url_for = SOURCE_ADAPTERS[source]
        except KeyError as error:
            raise ValueError(f"Unsupported extraction source: {source}") from error

        supabase = SupabaseRest()
        records = supabase.find_pending_records(MAX_RECORDS, source)
        if not records:
            print(f"No eligible {source} sitemap discoveries to process.")
            return 0

        started_at = utc_now()
        job_rows = supabase.request(
            "POST",
            JOBS_TABLE,
            payload=[
                {
                    "source": source,
                    "job_type": "manual",
                    "crawl_type": "extraction",
                    "status": "running",
                    "discovered_count": len(records),
                    "started_at": started_at,
                }
            ],
            params={"select": "id"},
            prefer="return=representation",
        )
        if not job_rows or not job_rows[0].get("id"):
            raise RuntimeError("Supabase did not return the crawl job ID")
        job = job_rows[0]["id"]
        processed_count = 0

        def update_progress(record: dict, stats: ProcessStats) -> None:
            nonlocal processed_count
            processed_count += 1
            supabase.request(
                "PATCH",
                JOBS_TABLE,
                params={"id": f"eq.{job}"},
                payload={
                    "status": "running",
                    "extracted_count": stats.extracted,
                    "duplicate_count": stats.duplicates,
                    "failed_count": stats.failed,
                    "restricted_count": stats.restricted,
                    "last_processed_url": record["discovered_url"],
                    "error_summary": "\n".join(stats.errors)[:1000] or None,
                    "updated_at": utc_now(),
                },
                prefer="return=minimal",
            )
            print(
                f"Processed {processed_count}/{len(records)}: "
                f"{stats.extracted} extracted, {stats.duplicates} duplicates, "
                f"{stats.failed} failed, {stats.restricted} restricted."
            )

        adapter = adapter_type(delay_seconds=0, user_agent=user_agent)
        try:
            stats = process_discoveries(
                supabase,
                records,
                adapter,
                on_record_complete=update_progress,
                source=source,
                user_agent=user_agent,
                alternate_url_for=alternate_url_for,
            )
        finally:
            adapter.session.close()
        supabase.request(
            "PATCH",
            JOBS_TABLE,
            params={"id": f"eq.{job}"},
            payload={
                "status": "completed",
                "extracted_count": stats.extracted,
                "duplicate_count": stats.duplicates,
                "failed_count": stats.failed,
                "restricted_count": stats.restricted,
                "error_summary": "\n".join(stats.errors)[:1000] or None,
                "completed_at": utc_now(),
                "updated_at": utc_now(),
            },
            prefer="return=minimal",
        )
        print(
            f"Manual scrape completed: {len(records)} records, "
            f"{stats.extracted} extracted, {stats.duplicates} duplicates, "
            f"{stats.failed} failed, {stats.restricted} restricted."
        )
        return 0
    except Exception as error:
        if supabase is not None and job is not None:
            try:
                supabase.request(
                    "PATCH",
                    JOBS_TABLE,
                    params={"id": f"eq.{job}"},
                    payload={
                        "status": "failed",
                        "error_summary": str(error)[:1000],
                        "completed_at": utc_now(),
                        "updated_at": utc_now(),
                    },
                    prefer="return=minimal",
                )
            except Exception as update_error:
                print(f"Could not update failed crawl job: {update_error}", file=sys.stderr)
        print(f"Manual scrape failed: {error}", file=sys.stderr)
        return 1
    finally:
        if supabase is not None:
            supabase.session.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract pending sitemap discoveries")
    parser.add_argument("--source", choices=sorted(SOURCE_ADAPTERS), default="people")
    sys.exit(main(parser.parse_args().source))
