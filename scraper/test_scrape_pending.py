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
                "limit": "1000",
            },
        )

    def test_selects_pending_records_for_the_requested_source(self):
        supabase = MagicMock(spec=SupabaseRest)

        SupabaseRest.find_pending_records(supabase, MAX_RECORDS, "bjnews")

        self.assertEqual(
            supabase.request.call_args.kwargs["params"]["source"],
            "eq.bjnews",
        )

    @patch("scraper.scrape_pending.SupabaseRest")
    def test_completes_batch_with_record_failures_and_updates_progress(
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

        def process_records(
            _supabase, selected_records, _adapter, on_record_complete, **_kwargs
        ):
            on_record_complete(selected_records[0], ProcessStats(extracted=1))
            return ProcessStats(extracted=1, failed=1, errors=["article failed"])

        with patch("scraper.scrape_pending.process_discoveries", side_effect=process_records):
            self.assertEqual(main(), 0)

        supabase.find_pending_records.assert_called_once_with(MAX_RECORDS, "people")
        job_create = supabase.request.call_args_list[0]
        self.assertEqual(job_create.args[:2], ("POST", JOBS_TABLE))
        self.assertEqual(job_create.kwargs["payload"][0]["job_type"], "manual")
        self.assertEqual(job_create.kwargs["payload"][0]["crawl_type"], "extraction")
        self.assertEqual(job_create.kwargs["payload"][0]["discovered_count"], 2)

        job_updates = [
            call
            for call in supabase.request.call_args_list
            if call.args[:2] == ("PATCH", JOBS_TABLE)
        ]
        self.assertEqual(len(job_updates), 2)
        self.assertEqual(job_updates[0].kwargs["payload"]["extracted_count"], 1)
        self.assertEqual(job_updates[-1].kwargs["payload"]["status"], "completed")
        self.assertEqual(job_updates[-1].kwargs["payload"]["failed_count"], 1)
        supabase.session.close.assert_called_once()

    @patch("scraper.scrape_pending.SupabaseRest")
    def test_fatal_error_fails_job_and_returns_nonzero(self, supabase_factory):
        supabase = MagicMock()
        supabase.find_pending_records.return_value = [
            {"id": "discovery-id", "discovered_url": "https://www.people.com.cn/a.html"}
        ]
        supabase.request.return_value = [{"id": "crawl-job-id"}]
        supabase_factory.return_value = supabase

        with patch(
            "scraper.scrape_pending.process_discoveries",
            side_effect=RuntimeError("Database unavailable"),
        ):
            self.assertEqual(main(), 1)

        job_updates = [
            call
            for call in supabase.request.call_args_list
            if call.args[:2] == ("PATCH", JOBS_TABLE)
        ]
        self.assertEqual(job_updates[-1].kwargs["payload"]["status"], "failed")
        self.assertEqual(
            job_updates[-1].kwargs["payload"]["error_summary"],
            "Database unavailable",
        )
        supabase.session.close.assert_called_once()

    @patch("scraper.scrape_pending.SupabaseRest")
    def test_does_not_create_job_when_no_records_are_eligible(self, supabase_factory):
        supabase = MagicMock()
        supabase.find_pending_records.return_value = []
        supabase_factory.return_value = supabase

        self.assertEqual(main(), 0)

        supabase.request.assert_not_called()
        supabase.session.close.assert_called_once()

    @patch("scraper.scrape_pending.process_discoveries")
    @patch("scraper.scrape_pending.SupabaseRest")
    def test_runs_bjnews_extraction_with_its_adapter_and_source(
        self, supabase_factory, process_records
    ):
        supabase = MagicMock()
        supabase.find_pending_records.return_value = [
            {"id": "bjnews-record", "discovered_url": "https://www.bjnews.com.cn/detail/123.html"}
        ]
        supabase.request.return_value = [{"id": "crawl-job-id"}]
        supabase_factory.return_value = supabase
        process_records.return_value = ProcessStats(extracted=1)

        self.assertEqual(main(source="bjnews"), 0)

        supabase.find_pending_records.assert_called_once_with(MAX_RECORDS, "bjnews")
        self.assertEqual(
            supabase.request.call_args_list[0].kwargs["payload"][0]["source"],
            "bjnews",
        )
        process_records.assert_called_once()
        self.assertEqual(process_records.call_args.kwargs["source"], "bjnews")
        self.assertIsNone(process_records.call_args.kwargs["alternate_url_for"])
        adapter = process_records.call_args.args[2]
        self.assertEqual(adapter.source_id, "bjnews")
        self.assertEqual(
            adapter.session.headers["User-Agent"],
            "CHNscraping article extraction; contact repository owner",
        )

    @patch("scraper.scrape_pending.SupabaseRest")
    def test_rejects_disabled_xinhua_without_connecting(self, supabase_factory):
        self.assertEqual(main("xinhua"), 1)
        supabase_factory.assert_not_called()

    @patch("scraper.scrape_pending.process_discoveries")
    @patch("scraper.scrape_pending.SupabaseRest")
    def test_runs_cankaoxiaoxi_search_extraction(
        self, supabase_factory, process_records
    ):
        supabase = MagicMock()
        supabase.find_pending_records.return_value = [
            {"id": "record", "discovered_url": "https://ckxxapp.ckxx.net/pages/2026/11/19/article.html"}
        ]
        supabase.request.return_value = [{"id": "job"}]
        supabase_factory.return_value = supabase
        process_records.return_value = ProcessStats(extracted=1)

        self.assertEqual(main("cankaoxiaoxi"), 0)

        supabase.find_pending_records.assert_called_once_with(
            MAX_RECORDS, "cankaoxiaoxi", "search"
        )
        self.assertEqual(process_records.call_args.args[2].source_id, "cankaoxiaoxi")
        self.assertFalse(process_records.call_args.args[2].follow_redirects)
        self.assertEqual(process_records.call_args.kwargs["source"], "cankaoxiaoxi")
        self.assertIsNone(process_records.call_args.kwargs["alternate_url_for"])

    @patch("scraper.scrape_pending.process_discoveries")
    @patch("scraper.scrape_pending.SupabaseRest")
    def test_runs_gmw_sitemap_extraction(self, supabase_factory, process_records):
        supabase = MagicMock()
        supabase.find_pending_records.return_value = [
            {"id": "record", "discovered_url": "https://news.gmw.cn/2026-11/19/content_1.htm"}
        ]
        supabase.request.return_value = [{"id": "job"}]
        supabase_factory.return_value = supabase
        process_records.return_value = ProcessStats(extracted=1)
        self.assertEqual(main("gmw"), 0)
        supabase.find_pending_records.assert_called_once_with(MAX_RECORDS, "gmw")
        self.assertEqual(process_records.call_args.args[2].source_id, "gmw")
        self.assertEqual(process_records.call_args.kwargs["source"], "gmw")
        self.assertIsNone(process_records.call_args.kwargs["alternate_url_for"])


if __name__ == "__main__":
    unittest.main()
