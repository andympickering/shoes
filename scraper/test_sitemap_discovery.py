import unittest
from unittest.mock import MagicMock, call, patch

import requests

from .sitemap_discovery import (
    BJNEWS_ROBOTS_URL,
    BJNEWS_SITEMAP_URL,
    SitemapFetchError,
    _allowed_url,
    fetch_document,
    main,
    parse_robots_txt,
    parse_sitemap_xml,
    read_sitemap_urls,
)


class SitemapDiscoveryTests(unittest.TestCase):
    def test_parse_sitemap_index(self):
        xml = b"""<?xml version="1.0"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>https://www.people.cn/news.xml</loc></sitemap>
        </sitemapindex>"""
        self.assertEqual(
            parse_sitemap_xml(xml),
            ("index", ["https://www.people.cn/news.xml"]),
        )

    def test_parse_urlset(self):
        xml = b"""<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://www.people.com.cn/article.html</loc></url>
        </urlset>"""
        self.assertEqual(
            parse_sitemap_xml(xml),
            ("urlset", ["https://www.people.com.cn/article.html"]),
        )

    def test_reject_unsupported_domains(self):
        self.assertFalse(_allowed_url("https://example.com/sitemap.xml"))
        self.assertFalse(_allowed_url("file:///etc/passwd"))
        self.assertTrue(_allowed_url("https://tw.people.com.cn/sitemap.xml"))
        self.assertTrue(
            _allowed_url(
                "https://www.bjnews.com.cn/sitemap.xml",
                ("bjnews.com.cn",),
            )
        )

    def test_parse_robots_sitemap_and_crawl_delay(self):
        robots = """User-agent: *
Crawl-delay: 120
Sitemap: http://www.people.cn/sitemap_index.xml
"""
        self.assertEqual(
            parse_robots_txt(robots),
            (["http://www.people.cn/sitemap_index.xml"], 120.0),
        )

    def test_robots_missing_sitemap_is_an_error(self):
        with self.assertRaisesRegex(ValueError, "did not advertise"):
            parse_robots_txt("User-agent: *\nDisallow: /private\n")

    @patch("scraper.sitemap_discovery._wait_for_crawl_delay")
    def test_fetch_retries_connection_timeout_and_honors_crawl_delay(self, wait):
        session = MagicMock()
        response = MagicMock(ok=True, is_redirect=False, is_permanent_redirect=False)
        response.content = b"User-agent: *"
        session.get.side_effect = [
            requests.ConnectTimeout("first timeout"),
            requests.ConnectionError("connection failed"),
            response,
        ]

        with patch("scraper.sitemap_discovery.time.monotonic", side_effect=[2, 4, 6]):
            content, last_request_at = fetch_document(
                session, BJNEWS_ROBOTS_URL, 120, None, ("bjnews.com.cn",)
            )

        self.assertEqual(content, b"User-agent: *")
        self.assertEqual(last_request_at, 6)
        self.assertEqual(session.get.call_count, 3)
        self.assertEqual(wait.call_args_list, [call(120, None), call(120, 2), call(120, 4)])

    @patch("scraper.sitemap_discovery._wait_for_crawl_delay")
    def test_fetch_fails_after_bounded_retries(self, wait):
        session = MagicMock()
        session.get.side_effect = requests.ConnectTimeout("unreachable")

        with patch("scraper.sitemap_discovery.time.monotonic", side_effect=[2, 4, 6]):
            with self.assertRaisesRegex(SitemapFetchError, "unreachable") as error:
                fetch_document(session, BJNEWS_ROBOTS_URL, 0, None, ("bjnews.com.cn",))

        self.assertEqual(error.exception.last_request_at, 6)
        self.assertEqual(session.get.call_count, 3)
        self.assertEqual(wait.call_args_list, [call(0, None), call(5, 2), call(10, 4)])

    @patch("scraper.sitemap_discovery._wait_for_crawl_delay")
    def test_fetch_does_not_retry_non_transient_request_errors(self, _wait):
        session = MagicMock()
        session.get.side_effect = requests.exceptions.InvalidURL("invalid URL")
        with self.assertRaisesRegex(SitemapFetchError, "invalid URL"):
            fetch_document(session, BJNEWS_ROBOTS_URL, 0, None, ("bjnews.com.cn",))
        self.assertEqual(session.get.call_count, 1)

    @patch("scraper.sitemap_discovery.read_sitemap_urls")
    @patch("scraper.sitemap_discovery.SupabaseRest")
    def test_main_records_failed_robots_fetch(self, supabase_factory, read_sitemaps):
        supabase = MagicMock()
        supabase.request.return_value = [{"id": "job-id"}]
        supabase_factory.return_value = supabase
        read_sitemaps.side_effect = SitemapFetchError("robots unreachable", 1.0)

        with patch("scraper.sitemap_discovery.requests.Session"):
            self.assertEqual(main(source="bjnews"), 1)

        update = supabase.request.call_args_list[-1]
        self.assertEqual(update.args[:2], ("PATCH", "chnscraping_crawl_jobs"))
        self.assertEqual(update.kwargs["payload"]["status"], "failed")
        self.assertEqual(update.kwargs["payload"]["error_summary"], "robots unreachable")

    def test_reads_explicit_bjnews_sitemap_and_robots_delay(self):
        robots = b"User-agent: *\nCrawl-delay: 5\n"
        sitemap = b"""<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://www.bjnews.com.cn/detail/123.html</loc></url>
        </urlset>"""

        def fake_fetch(_session, url, delay, last_request_at, _domains):
            if url == BJNEWS_ROBOTS_URL:
                self.assertEqual(delay, 0)
                self.assertIsNone(last_request_at)
                return robots, 1.0
            self.assertEqual(url, BJNEWS_SITEMAP_URL)
            self.assertEqual(delay, 5.0)
            self.assertEqual(last_request_at, 1.0)
            return sitemap, 2.0

        with patch(
            "scraper.sitemap_discovery.fetch_document",
            side_effect=fake_fetch,
        ) as fetch:
            article_urls, errors = read_sitemap_urls(object(), source="bjnews")

        self.assertEqual(
            article_urls,
            {
                "https://www.bjnews.com.cn/detail/123.html": (
                    "https://www.bjnews.com.cn/detail/123.html",
                    BJNEWS_SITEMAP_URL,
                )
            },
        )
        self.assertEqual(errors, [])
        self.assertEqual(fetch.call_count, 2)

    @patch("scraper.sitemap_discovery.fetch_document")
    def test_reads_sitemap_urls_and_retains_successes_on_child_failure(self, fetch):
        index_url = "https://www.people.cn/sitemap_index.xml"
        article_sitemap = "https://www.people.cn/news.xml"
        failed_sitemap = "https://www.people.cn/failed.xml"
        robots = b"User-agent: *\nCrawl-delay: 120\nSitemap: " + index_url.encode()
        index = f"""<sitemapindex>
          <sitemap><loc>{article_sitemap}</loc></sitemap>
          <sitemap><loc>{failed_sitemap}</loc></sitemap>
          <sitemap><loc>{article_sitemap}</loc></sitemap>
        </sitemapindex>""".encode()
        urlset = b"""<urlset>
          <url><loc>http://www.people.com.cn/article.html?utm_source=feed</loc></url>
        </urlset>"""

        def fetch_document(_session, url, _delay, _last_request_at, _domains):
            if url == "https://www.people.com.cn/robots.txt":
                return robots, 1.0
            if url == index_url:
                return index, 2.0
            if url == article_sitemap:
                return urlset, 3.0
            raise SitemapFetchError("temporary response error", 4.0)

        fetch.side_effect = fetch_document
        article_urls, errors = read_sitemap_urls(object())

        self.assertEqual(
            article_urls,
            {
                "http://www.people.com.cn/article.html": (
                    "http://www.people.com.cn/article.html?utm_source=feed",
                    article_sitemap,
                )
            },
        )
        self.assertEqual(len(errors), 1)
        self.assertIn(failed_sitemap, errors[0])

    @patch("scraper.sitemap_discovery.read_sitemap_urls")
    @patch("scraper.sitemap_discovery.SupabaseRest")
    def test_main_saves_discovery_records_without_extracting_articles(
        self, supabase_factory, read_sitemaps
    ):
        article_url = "https://www.people.com.cn/article.html"
        sitemap_url = "https://www.people.cn/news.xml"
        supabase = MagicMock()
        supabase.request.side_effect = [
            [{"id": "job-id"}],
            [{"id": "discovery-id"}],
            [],
        ]
        supabase.find_existing.return_value = set()
        supabase_factory.return_value = supabase
        read_sitemaps.return_value = (
            {article_url: (article_url, sitemap_url)},
            [],
        )

        with patch("scraper.sitemap_discovery.requests.Session"):
            self.assertEqual(main(), 0)

        job_call = supabase.request.call_args_list[0]
        self.assertEqual(job_call.kwargs["payload"][0]["job_type"], "weekly")
        self.assertEqual(job_call.kwargs["payload"][0]["crawl_type"], "discovery")
        insert_call = next(
            call
            for call in supabase.request.call_args_list
            if call.args[0] == "POST" and call.args[1] == "chnscraping_discovery_records"
        )
        record = insert_call.kwargs["payload"][0]
        self.assertEqual(record["discovery_method"], "sitemap")
        self.assertEqual(record["processing_status"], "pending")
        self.assertEqual(record["discovered_from_url"], sitemap_url)
        self.assertEqual(record["discovered_url"], article_url)
        self.assertFalse(
            any(
                call.args[1] == "chnscraping_articles"
                for call in supabase.request.call_args_list
            )
        )

    @patch("scraper.sitemap_discovery.read_sitemap_urls")
    @patch("scraper.sitemap_discovery.SupabaseRest")
    def test_main_records_bjnews_as_its_own_daily_source(
        self, supabase_factory, read_sitemaps
    ):
        article_url = "https://www.bjnews.com.cn/detail/123.html"
        supabase = MagicMock()
        supabase.request.side_effect = [
            [{"id": "job-id"}],
            [{"id": "discovery-id"}],
            [],
        ]
        supabase.find_existing.return_value = set()
        supabase_factory.return_value = supabase
        read_sitemaps.return_value = (
            {article_url: (article_url, BJNEWS_SITEMAP_URL)},
            [],
        )

        with patch("scraper.sitemap_discovery.requests.Session"):
            self.assertEqual(main(source="bjnews"), 0)

        self.assertEqual(
            supabase.request.call_args_list[0].kwargs["payload"][0]["source"],
            "bjnews",
        )
        self.assertEqual(
            supabase.request.call_args_list[0].kwargs["payload"][0]["job_type"],
            "daily",
        )
        insert_call = next(
            call
            for call in supabase.request.call_args_list
            if call.args[:2] == ("POST", "chnscraping_discovery_records")
        )
        record = insert_call.kwargs["payload"][0]
        self.assertEqual(record["source"], "bjnews")
        self.assertEqual(record["discovery_method"], "sitemap")
        self.assertEqual(record["discovered_from_url"], BJNEWS_SITEMAP_URL)


if __name__ == "__main__":
    unittest.main()
