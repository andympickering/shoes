import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from .xinhua_search_discovery import active_alert_terms, alert_terms, main, search_term


class XinhuaSearchDiscoveryTests(unittest.TestCase):
    def test_extracts_terms_from_boolean_expression_and_quoted_operators(self):
        self.assertEqual(
            alert_terms('(经济 OR "人工 智能") AND "OR"'),
            ["经济", "人工 智能", "OR"],
        )

    def test_loads_all_active_alert_pages_and_deduplicates_terms(self):
        supabase = MagicMock()
        supabase.request.side_effect = [
            [{"id": str(i), "search_terms": "经济 OR 中国"} for i in range(500)],
            [{"id": "501", "search_terms": "中国 AND 发展"}],
        ]
        self.assertEqual(active_alert_terms(supabase), ["经济", "中国", "发展"])
        self.assertEqual(supabase.request.call_args.kwargs["params"]["offset"], "500")
        self.assertEqual(supabase.request.call_args.kwargs["params"]["active"], "eq.true")

    @patch("scraper.xinhua_search_discovery.time.sleep")
    def test_paginates_filters_24_hours_and_deduplicates(self, _sleep):
        session = MagicMock()
        recent = "https://www.news.cn/20261119/a/c.html"
        older = "https://www.news.cn/20261118/b/c.html"
        boundary = "https://www.news.cn/20261118/c/c.html"

        def response(page, results):
            result = MagicMock(status_code=200)
            result.json.return_value = {
                "code": 200,
                "content": {"curPage": page, "pageCount": 3, "results": results},
            }
            return result

        session.get.side_effect = [
            response(1, [{"url": recent + "?utm_source=test", "pubtime": "2026-11-19 08:00:00"}]),
            response(2, [
                {"url": recent, "pubtime": "2026-11-19 08:00:00"},
                {"url": boundary, "pubtime": "2026-11-18 08:00:00"},
                {"url": older, "pubtime": "2026-11-18 07:59:59"},
            ]),
        ]
        end = datetime(2026, 11, 19, 0, 0, tzinfo=timezone.utc)
        articles = {}
        search_term(session, "中国", end - timedelta(days=1), end, articles, None)
        self.assertEqual(articles, {recent: recent + "?utm_source=test", boundary: boundary})
        self.assertEqual(session.get.call_count, 2)
        self.assertEqual(session.get.call_args.kwargs["params"]["curPage"], 2)

    def test_rejects_non_chronological_results_and_http_errors(self):
        session = MagicMock()
        session.get.return_value.status_code = 403
        end = datetime.now(timezone.utc)
        with self.assertRaisesRegex(RuntimeError, "HTTP 403"):
            search_term(session, "term", end - timedelta(days=2), end, {}, None)
        session.get.return_value.status_code = 200
        session.get.return_value.json.return_value = {
            "code": 200,
            "content": {
                "curPage": 1, "pageCount": 1,
                "results": [
                    {"url": "https://www.news.cn/a.html", "pubtime": "2026-11-18 00:00:00"},
                    {"url": "https://www.news.cn/b.html", "pubtime": "2026-11-19 00:00:00"},
                ],
            },
        }
        end = datetime(2026, 11, 20, tzinfo=timezone.utc)
        with self.assertRaisesRegex(ValueError, "not ordered"):
            search_term(session, "term", end - timedelta(days=2), end, {}, None)

    @patch("scraper.xinhua_search_discovery.MAX_PAGES", 1)
    def test_reports_limit_if_results_do_not_reach_cutoff(self):
        session = MagicMock()
        session.get.return_value.status_code = 200
        session.get.return_value.json.return_value = {
            "code": 200,
            "content": {
                "curPage": 1, "pageCount": 1,
                "results": [
                    {"url": "https://www.news.cn/a.html", "pubtime": "2026-11-19 08:00:00"},
                ],
            },
        }
        end = datetime(2026, 11, 19, tzinfo=timezone.utc)
        with self.assertRaisesRegex(RuntimeError, "result limit"):
            search_term(session, "term", end - timedelta(days=2), end, {}, None)

    @patch("scraper.xinhua_search_discovery.search_term")
    @patch("scraper.xinhua_search_discovery.SupabaseRest")
    def test_partial_job_saves_successes_even_when_another_search_fails(self, factory, search):
        supabase = MagicMock()
        factory.return_value = supabase
        supabase.request.side_effect = [
            [{"id": "job"}],
            [{"id": "alert", "search_terms": "中国 OR 经济"}],
            [{"id": "record"}],
            [],
        ]
        supabase.find_existing.return_value = set()

        def find(_session, term, _start, _end, articles, _last):
            if term == "经济":
                raise RuntimeError("HTTP 403")
            articles["https://www.news.cn/a.html"] = "https://www.news.cn/a.html"
            return 1.0

        search.side_effect = find
        self.assertEqual(main(), 1)
        for call in search.call_args_list:
            self.assertEqual(call.args[3] - call.args[2], timedelta(hours=24))
        insert = supabase.request.call_args_list[2]
        self.assertEqual(insert.kwargs["payload"][0]["discovery_method"], "search")
        self.assertEqual(supabase.request.call_args_list[-1].kwargs["payload"]["status"], "partial")
        supabase.session.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
