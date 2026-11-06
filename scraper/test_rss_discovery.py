import os
import unittest
from unittest.mock import MagicMock, patch

from .adapters.base import Article
from .adapters.people import PeopleAdapter
from .rss_discovery import (
    ARTICLES_TABLE,
    ARTICLE_USER_AGENT,
    TABLE,
    ProcessStats,
    SupabaseRest,
    main,
    process_discoveries,
    read_robots_policy,
)


class RssDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.record = {
            "id": "discovery-id",
            "discovered_url": "https://www.people.com.cn/article.html",
        }
        self.article = Article(
            headline="A test headline",
            story_text="A test headline followed by the full article body.",
            url=self.record["discovered_url"],
        )
        self.adapter = MagicMock(spec=PeopleAdapter)
        self.adapter._parse_article.return_value = self.article
        self.robots = MagicMock()
        self.robots.can_fetch.return_value = True

    @patch("scraper.rss_discovery.read_robots_policy")
    @patch("scraper.rss_discovery.wait_for_crawl_delay")
    def test_saves_new_article_and_marks_discovery_processed(self, _wait, read_robots):
        read_robots.return_value = self.robots, 0
        supabase = MagicMock()
        supabase.request.return_value = [{"id": "article-id"}]

        stats = process_discoveries(supabase, [self.record], self.adapter)

        self.assertEqual(stats.extracted, 1)
        self.assertEqual(stats.duplicates, 0)
        post_article = next(
            call
            for call in supabase.request.call_args_list
            if call.args[:2] == ("POST", ARTICLES_TABLE)
        )
        self.assertEqual(post_article.kwargs["payload"][0]["url"], self.article.url)
        self.assertEqual(
            post_article.kwargs["payload"][0]["story_text"],
            self.article.story_text,
        )
        final_update = [
            call
            for call in supabase.request.call_args_list
            if call.args[:2] == ("PATCH", TABLE)
        ][-1]
        self.assertEqual(final_update.kwargs["payload"]["processing_status"], "processed")
        self.assertEqual(final_update.kwargs["payload"]["article_id"], "article-id")

    @patch("scraper.rss_discovery.read_robots_policy")
    @patch("scraper.rss_discovery.wait_for_crawl_delay")
    def test_marks_existing_article_as_duplicate(self, _wait, read_robots):
        read_robots.return_value = self.robots, 0
        supabase = MagicMock()

        def find_existing_article(method, table, **_kwargs):
            if method == "POST" and table == ARTICLES_TABLE:
                return []
            if method == "GET" and table == ARTICLES_TABLE:
                return [{"id": "existing-article-id"}]
            return []

        supabase.request.side_effect = find_existing_article

        stats = process_discoveries(supabase, [self.record], self.adapter)

        self.assertEqual(stats.extracted, 0)
        self.assertEqual(stats.duplicates, 1)
        self.assertTrue(
            any(
                call.args[:2] == ("GET", ARTICLES_TABLE)
                for call in supabase.request.call_args_list
            )
        )
        final_update = [
            call
            for call in supabase.request.call_args_list
            if call.args[:2] == ("PATCH", TABLE)
        ][-1]
        self.assertEqual(final_update.kwargs["payload"]["processing_status"], "duplicate")
        self.assertEqual(
            final_update.kwargs["payload"]["article_id"],
            "existing-article-id",
        )

    @patch("scraper.rss_discovery.read_robots_policy")
    def test_marks_disallowed_url_restricted_without_fetching_article(self, read_robots):
        self.robots.can_fetch.return_value = False
        read_robots.return_value = self.robots, 0
        supabase = MagicMock()

        stats = process_discoveries(supabase, [self.record], self.adapter)

        self.assertEqual(stats.restricted, 1)
        self.adapter._parse_article.assert_not_called()
        self.assertFalse(
            any(call.args[:2] == ("POST", ARTICLES_TABLE) for call in supabase.request.call_args_list)
        )

    @patch("scraper.rss_discovery.read_robots_policy")
    @patch("scraper.rss_discovery.wait_for_crawl_delay")
    def test_does_not_save_headline_only_extraction(self, _wait, read_robots):
        read_robots.return_value = self.robots, 0
        self.adapter._parse_article.return_value = Article(
            headline="A test headline",
            story_text="A test headline",
            url=self.record["discovered_url"],
        )
        supabase = MagicMock()

        stats = process_discoveries(supabase, [self.record], self.adapter)

        self.assertEqual(stats.failed, 1)
        self.assertFalse(
            any(call.args[:2] == ("POST", ARTICLES_TABLE) for call in supabase.request.call_args_list)
        )

    def test_supabase_rest_uses_service_key_as_bearer_token(self):
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_KEY": "test-service-key",
            },
        ):
            client = SupabaseRest()
        self.assertEqual(
            client.session.headers["Authorization"],
            "Bearer test-service-key",
        )
        client.session.close()

    def test_robots_parser_returns_crawl_delay_and_rules(self):
        response = MagicMock()
        response.status_code = 200
        response.content = b"User-agent: *\nCrawl-delay: 120\nDisallow: /blocked\n"
        response.text = response.content.decode()
        session = MagicMock()
        session.get.return_value = response

        robots, delay = read_robots_policy(
            session,
            "https://www.people.com.cn/news/article.html",
        )

        self.assertEqual(delay, 120)
        self.assertTrue(robots.can_fetch(ARTICLE_USER_AGENT, "https://www.people.com.cn/news/article.html"))
        self.assertFalse(robots.can_fetch(ARTICLE_USER_AGENT, "https://www.people.com.cn/blocked/article.html"))

    @patch("scraper.rss_discovery.process_discoveries")
    @patch("scraper.rss_discovery.PeopleAdapter")
    @patch("scraper.rss_discovery.read_feed")
    @patch("scraper.rss_discovery.SupabaseRest")
    def test_main_scrapes_only_new_discovery_rows_and_updates_job_counts(
        self, supabase_factory, read_feed, adapter_factory, process_records
    ):
        new_record = {
            "id": "new-discovery-id",
            "discovered_url": self.record["discovered_url"],
            "attempts": 0,
        }
        supabase = MagicMock()
        supabase.request.side_effect = [
            [{"id": "crawl-job-id"}],
            [],
            [],
        ]
        supabase.find_existing.return_value = set()
        supabase.find_pending.return_value = [new_record]
        supabase_factory.return_value = supabase
        read_feed.return_value = [(self.record["discovered_url"], self.record["discovered_url"])]
        process_records.return_value = ProcessStats(extracted=1)

        self.assertEqual(main(), 0)

        process_records.assert_called_once_with(
            supabase,
            [new_record],
            adapter_factory.return_value,
        )
        self.assertEqual(
            supabase.request.call_args_list[0].kwargs["payload"][0]["job_type"],
            "hourly",
        )
        job_update = supabase.request.call_args_list[-1]
        self.assertEqual(job_update.kwargs["payload"]["extracted_count"], 1)
        self.assertEqual(job_update.kwargs["payload"]["failed_count"], 0)
        self.assertEqual(job_update.kwargs["payload"]["status"], "completed")


if __name__ == "__main__":
    unittest.main()
