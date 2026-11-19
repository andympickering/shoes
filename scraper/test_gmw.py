import unittest
from unittest.mock import MagicMock, patch

import requests

from .adapters.gmw import GmwAdapter
from .rss_discovery import GmwRobotsPolicy, ProcessStats, process_discoveries
from .sitemap_discovery import read_sitemap_urls


def response(url, content, status=200, location=None):
    result = requests.Response()
    result.url = url
    result.status_code = status
    result._content = content.encode("utf-8")
    if location:
        result.headers["Location"] = location
    return result


class GmwTests(unittest.TestCase):
    def test_extracts_article_body_and_china_timestamp(self):
        url = "https://news.gmw.cn/2026-11/19/content_123.htm"
        html = """<html><head><meta charset="utf-8">
          <meta property="article:published_time" content="2026-11-19T15:05:17+08:00">
          </head><body><h1>新闻标题</h1>
          <div id="ContentPh"><p>第一段文字。</p><p>第二段文字。</p></div>
          <div><p>Related article</p></div></body></html>"""
        adapter = GmwAdapter()
        adapter.session.get = MagicMock(return_value=response(url, html))
        article = adapter._parse_article(url)
        self.assertIsNotNone(article)
        self.assertEqual(article.headline, "新闻标题")
        self.assertEqual(article.story_text, "第一段文字。\n\n第二段文字。")
        self.assertEqual(article.published_at.isoformat(), "2026-11-19T15:05:17+08:00")
        adapter.session.get.assert_called_once_with(url, timeout=15, allow_redirects=False)

    def test_refuses_redirect_and_does_not_invent_body(self):
        adapter = GmwAdapter()
        url = "https://news.gmw.cn/a.htm"
        adapter.session.get = MagicMock(return_value=response(url, "", 302, "https://other.example/"))
        with self.assertRaises(requests.HTTPError):
            adapter._parse_article(url)
        adapter.session.get.return_value = response(url, "<h1>Headline</h1>")
        self.assertIsNone(adapter._parse_article(url))

    def test_extracts_photo_story_captions(self):
        url = "https://politics.gmw.cn/2026-11/19/content_123.htm"
        adapter = GmwAdapter()
        adapter.session.get = MagicMock(return_value=response(
            url, '<meta charset="utf-8"><h1>图片新闻</h1>'
                 '<div class="h-contentMain"><p><img src="photo.jpg"></p>'
                 '<p class="pictext">照片说明。</p><p>正文。</p></div>'
        ))
        article = adapter._parse_article(url)
        self.assertIsNotNone(article)
        self.assertEqual(article.story_text, "照片说明。\n\n正文。")

    def test_robots_wildcards_and_user_agent_groups(self):
        policy = GmwRobotsPolicy("User-agent: *\nDisallow: /*2013\nDisallow: /content/\n"
                                 "User-agent: GPTBot\nAllow: /\n")
        self.assertFalse(policy.can_fetch(GmwAdapter.USER_AGENT, "https://news.gmw.cn/2013/a.htm"))
        self.assertFalse(policy.can_fetch(GmwAdapter.USER_AGENT, "https://www.gmw.cn/content/a.htm"))
        self.assertTrue(policy.can_fetch(GmwAdapter.USER_AGENT, "https://news.gmw.cn/2026/a.htm"))

    @patch("scraper.sitemap_discovery._wait_for_crawl_delay")
    def test_discovery_checks_each_sitemap_origin_and_redirect(self, _wait):
        root = "https://www.gmw.cn/robots.txt"
        index = "https://www.gmw.cn/google.xml"
        child = "https://news.gmw.cn/google_news.xml"
        blocked = "https://news.gmw.cn/blocked.xml"
        article = "https://news.gmw.cn/2026-11/19/content_123.htm"
        pages = {
            root: response(root, f"User-agent: *\nDisallow: /content/\nSitemap: {index}\n"),
            index: response(index, f"<sitemapindex><sitemap><loc>http://news.gmw.cn/google_news.xml</loc></sitemap>"
                                   f"<sitemap><loc>{blocked}</loc></sitemap></sitemapindex>"),
            "https://news.gmw.cn/robots.txt": response(
                "https://news.gmw.cn/robots.txt", "User-agent: *\nDisallow: /blocked.xml\nCrawl-delay: 5\n"
            ),
            child: response(child, f"<urlset><url><loc>{article}</loc></url>"
                                   "<url><loc>https://evil.example/a.htm</loc></url></urlset>"),
        }
        session = MagicMock()
        session.get.side_effect = lambda url, **kwargs: pages[url]
        found, errors = read_sitemap_urls(session, "gmw")
        self.assertEqual(found, {article: (article, child)})
        self.assertEqual(errors, [])
        self.assertNotIn(blocked, [call.args[0] for call in session.get.call_args_list])
        self.assertEqual(session.get.call_count, 4)

    @patch("scraper.sitemap_discovery._wait_for_crawl_delay")
    def test_sitemap_redirect_to_disallowed_path_is_not_fetched(self, _wait):
        root = "https://www.gmw.cn/robots.txt"
        sitemap = "https://www.gmw.cn/google.xml"
        blocked = "https://www.gmw.cn/content/private.xml"
        pages = {
            root: response(root, f"User-agent: *\nDisallow: /content/\nSitemap: {sitemap}\n"),
            sitemap: response(sitemap, "", 302, blocked),
        }
        session = MagicMock()
        session.get.side_effect = lambda url, **kwargs: pages[url]
        found, errors = read_sitemap_urls(session, "gmw")
        self.assertEqual((found, errors), ({}, []))
        self.assertEqual(session.get.call_count, 2)

    @patch("scraper.rss_discovery.wait_for_crawl_delay")
    @patch("scraper.rss_discovery.read_robots_policy")
    def test_extraction_marks_wildcard_disallowed_url_restricted(self, read_policy, _wait):
        read_policy.return_value = (GmwRobotsPolicy("User-agent: *\nDisallow: /*2013\n"), 3)
        adapter = MagicMock()
        db = MagicMock()
        record = {"id": "1", "discovered_url": "https://news.gmw.cn/2013/a.htm"}
        stats = process_discoveries(db, [record], adapter, robots_session=MagicMock(),
                                    source="gmw", user_agent=GmwAdapter.USER_AGENT,
                                    alternate_url_for=None)
        self.assertEqual(stats, ProcessStats(restricted=1))
        adapter._parse_article.assert_not_called()
        self.assertEqual(db.request.call_args.kwargs["payload"]["processing_status"], "restricted")


if __name__ == "__main__":
    unittest.main()
