"""Extract articles from pending People's Daily sitemap discoveries."""
import sys

from dotenv import load_dotenv
from pathlib import Path

from .adapters.people import PeopleAdapter
from .rss_discovery import (
    ARTICLE_USER_AGENT,
    ProcessStats,
    SupabaseRest,
    process_discoveries,
    utc_now,
)


MAX_RECORDS = 100
JOBS_TABLE = "chnscraping_crawl_jobs"

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)


def main() -> int:
    job = None
    supabase = None
    try:
        supabase = SupabaseRest()
        records = supabase.find_pending_records(MAX_RECORDS)
        if not records:
            print("No eligible People's Daily sitemap discoveries to process.")
            return 0

        started_at = utc_now()
        job_rows = supabase.request(
            "POST",
            JOBS_TABLE,
            payload=[
                {
                    "source": "people",
                    "job_type": "manual",
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

        adapter = PeopleAdapter(delay_seconds=0, user_agent=ARTICLE_USER_AGENT)
        try:
            stats = process_discoveries(
                supabase,
                records,
                adapter,
                on_record_complete=update_progress,
            )
        finally:
            adapter.session.close()
        status = "partial" if stats.failed or stats.restricted else "completed"
        supabase.request(
            "PATCH",
            JOBS_TABLE,
            params={"id": f"eq.{job}"},
            payload={
                "status": status,
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
            f"Manual scrape {status}: {len(records)} records, "
            f"{stats.extracted} extracted, {stats.duplicates} duplicates, "
            f"{stats.failed} failed, {stats.restricted} restricted."
        )
        return 1 if stats.failed or stats.restricted else 0
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
    sys.exit(main())
