import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from .cankaoxiaoxi_search_discovery import main, search_term


class CankaoxiaoxiSearchDiscoveryTests(unittest.TestCase):
    @staticmethod
    def response(page, results, pages=3):
        result = MagicMock(status_code=200)
        result.json.return_value = {
            "status": "200",
            "pages": pages,
            "total": pages * 10,
            "list": results,
        }
        return result

    @staticmethod
    def item(url, published):
        return {
            "contentType": 1,
            "data": {"url": url, "publishTime": published},
        }

    @patch("scraper.cankaoxiaoxi_search_discovery.time.sleep")
    def test_paginates_filters_24_hours_and_deduplicates(self, _sleep):
        session = MagicMock()
        recent = "https://ckxxapp.ckxx.net/pages/2026/11/19/" + "a" * 32 + ".html"
        boundary = "https://ckxxapp.ckxx.net/pages/2026/11/18/" + "b" * 32 + ".html"
        old = "https://ckxxapp.ckxx.net/pages/2026/11/18/" + "c" * 32 + ".html"
        session.get.side_effect = [
            self.response(1, [
                self.item(recent + "?utm_source=test", "2026-11-19 08:00:00"),
            ]),
            self.response(2, [
                self.item(recent, "2026-11-19 08:00:00"),
                self.item(boundary, "2026-11-18 08:00:00"),
                self.item(old, "2026-11-18 07:59:59"),
            ]),
        ]
        end = datetime(2026, 11, 19, 0, 0, tzinfo=timezone.utc)
        articles = {}

        search_term(
            session,
            "中国",
            end - timedelta(days=1),
            end,
            articles,
            "pc-test",
            None,
        )

        self.assertEqual(articles, {recent: recent + "?utm_source=test", boundary: boundary})
        self.assertEqual(session.get.call_count, 2)
        self.assertEqual(session.get.call_args.kwargs["params"]["pageNum"], 2)
        self.assertEqual(session.get.call_args.kwargs["params"]["channelId"],
                         "d0b20aa58694484c83508e65c0c9a582")

    def test_rejects_http_errors_and_non_chronological_results(self):
        session = MagicMock()
        session.get.return_value.status_code = 403
        end = datetime.now(timezone.utc)
        with self.assertRaisesRegex(RuntimeError, "HTTP 403"):
            search_term(
                session, "term", end - timedelta(days=2), end, {}, "pc-test", None
            )

        session.get.return_value = self.response(1, [
            self.item(
                "https://ckxxapp.ckxx.net/pages/2026/11/19/" + "a" * 32 + ".html",
                "2026-11-18 00:00:00",
            ),
            self.item(
                "https://ckxxapp.ckxx.net/pages/2026/11/19/" + "b" * 32 + ".html",
                "2026-11-19 00:00:00",
            ),
        ], pages=1)
        end = datetime(2026, 11, 20, tzinfo=timezone.utc)
        with self.assertRaisesRegex(ValueError, "not ordered"):
            search_term(
                session, "term", end - timedelta(days=2), end, {}, "pc-test", None
            )

    def test_rejects_empty_intermediate_pages_and_invalid_result_hosts(self):
        session = MagicMock()
        session.get.return_value = self.response(1, [], pages=2)
        end = datetime.now(timezone.utc)
        with self.assertRaisesRegex(ValueError, "empty intermediate"):
            search_term(
                session, "term", end - timedelta(days=2), end, {}, "pc-test", None
            )

        session.get.return_value = self.response(1, [
            self.item("https://example.com/article.html", "2026-11-19 08:00:00")
        ], pages=1)
        with self.assertRaisesRegex(ValueError, "outside allowed"):
            search_term(
                session,
                "term",
                datetime(2026, 11, 18, tzinfo=timezone.utc),
                datetime(2026, 11, 20, tzinfo=timezone.utc),
                {},
                "pc-test",
                None,
            )

    @patch("scraper.cankaoxiaoxi_search_discovery.MAX_PAGES", 1)
    def test_reports_limit_if_results_do_not_reach_cutoff(self):
        session = MagicMock()
        session.get.return_value = self.response(1, [
            self.item(
                "https://ckxxapp.ckxx.net/pages/2026/11/19/" + "a" * 32 + ".html",
                "2026-11-19 08:00:00",
            )
        ], pages=1)
        end = datetime(2026, 11, 19, tzinfo=timezone.utc)

        with self.assertRaisesRegex(RuntimeError, "result limit"):
            search_term(
                session,
                "term",
                end - timedelta(days=2),
                end,
                {},
                "pc-test",
                None,
            )

    @patch("scraper.cankaoxiaoxi_search_discovery.search_term")
    @patch("scraper.cankaoxiaoxi_search_discovery.SupabaseRest")
    def test_persists_successful_search_results_with_partial_failure(
        self, supabase_factory, search
    ):
        supabase = MagicMock()
        supabase_factory.return_value = supabase
        supabase.request.side_effect = [
            [{"id": "job"}],
            [{"id": "alert", "search_terms": "中国 OR 经济"}],
            [{"id": "record"}],
            [],
        ]
        supabase.find_existing.return_value = set()

        def find(_session, term, _start, _end, articles, _app_id, _last):
            if term == "经济":
                raise RuntimeError("HTTP 403")
            url = "https://ckxxapp.ckxx.net/pages/2026/11/19/" + "a" * 32 + ".html"
            articles[url] = url
            return 1.0

        search.side_effect = find

        self.assertEqual(main(), 1)

        self.assertEqual(search.call_count, 2)
        self.assertEqual(search.call_args_list[0].args[3] -
                         search.call_args_list[0].args[2], timedelta(hours=24))
        insert = supabase.request.call_args_list[2]
        self.assertEqual(insert.kwargs["payload"][0]["discovery_method"], "search")
        self.assertEqual(
            supabase.request.call_args_list[-1].kwargs["payload"]["status"], "partial"
        )
        supabase.session.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
