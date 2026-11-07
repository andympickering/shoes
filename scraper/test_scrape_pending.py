import unittest
from unittest.mock import MagicMock, patch

from .rss_discovery import ProcessStats, SupabaseRest
from .scrape_pending import JOBS_TABLE, MAX_RECORDS, main


class ScrapePendingTests(unittest.TestCase):
    def test_selects_only_eligible_people_sitemap_records_with_the_limit(self):
        supabase = MagicMock(spec=SupabaseRest)

        SupabaseRest.find_pending_records(supabase, MAX_RECORDS)

        supabase.request.assert_called_once_with(
            "GET",
            "chnscraping_discovery_records",
            params={
                "select": "id,discovered_url,normalized_url,attempts,discovery_method",
                "source": "eq.people",
                "discovery_method": "eq.sitemap",
                "processing_status": "in.(pending,processing,failed)",
                "attempts": "lt.3",
                "order": "discovered_at.asc",
                "limit": "100",
            },
        )

    @patch("scraper.scrape_pending.SupabaseRest")
    def test_processes_at_most_100_pending_records_and_updates_progress(
        self, supabase_factory
    ):
        records = [
            {"id": "discovery-id", "discovered_url": "https://www.people.com.cn/a.html"},
            {"id": "discovery-id-2", "discovered_url": "https://www.people.com.cn/b.html"},
        ]
        supabase = MagicMock()
        supabase.find_pending_records.return_value = records
        supabase.request.return_value = [{"id": "crawl-job-id"}]
        supabase_factory.return_value = supabase

        def process_records(_supabase, selected_records, _adapter, on_record_complete):
            on_record_complete(selected_records[0], ProcessStats(extracted=1))
            return ProcessStats(extracted=1, failed=1, errors=["article failed"])

        with patch("scraper.scrape_pending.process_discoveries", side_effect=process_records):
            self.assertEqual(main(), 1)

        supabase.find_pending_records.assert_called_once_with(MAX_RECORDS)
        job_create = supabase.request.call_args_list[0]
        self.assertEqual(job_create.args[:2], ("POST", JOBS_TABLE))
        self.assertEqual(job_create.kwargs["payload"][0]["job_type"], "manual")
        self.assertEqual(job_create.kwargs["payload"][0]["discovered_count"], 2)

        job_updates = [
            call
            for call in supabase.request.call_args_list
            if call.args[:2] == ("PATCH", JOBS_TABLE)
        ]
        self.assertEqual(len(job_updates), 2)
        self.assertEqual(job_updates[0].kwargs["payload"]["extracted_count"], 1)
        self.assertEqual(job_updates[-1].kwargs["payload"]["status"], "partial")
        self.assertEqual(job_updates[-1].kwargs["payload"]["failed_count"], 1)
        supabase.session.close.assert_called_once()

    @patch("scraper.scrape_pending.SupabaseRest")
    def test_does_not_create_job_when_no_records_are_eligible(self, supabase_factory):
        supabase = MagicMock()
        supabase.find_pending_records.return_value = []
        supabase_factory.return_value = supabase

        self.assertEqual(main(), 0)

        supabase.request.assert_not_called()
        supabase.session.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
