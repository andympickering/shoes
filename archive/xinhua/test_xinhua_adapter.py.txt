import unittest
from unittest.mock import MagicMock

from .adapters.xinhua import XinhuaAdapter


class XinhuaAdapterTests(unittest.TestCase):
    def test_extracts_detail_content_and_short_paragraphs(self):
        adapter = XinhuaAdapter(delay_seconds=0)
        response = MagicMock(status_code=200)
        response.apparent_encoding = "utf-8"
        response.text = """
        <h1>Headline</h1><div>2026-11-19 05:16:44</div>
        <span id="detailContent"><p>First paragraph.</p><p>Short.</p></span>
        """
        adapter.session.get = MagicMock(return_value=response)
        article = adapter._parse_article("https://www.news.cn/a.html")
        self.assertIsNotNone(article)
        self.assertEqual(article.story_text, "First paragraph.\n\nShort.")
        self.assertEqual(article.published_at.isoformat(), "2026-11-19T05:16:44+08:00")
        adapter.session.close()

    def test_refuses_redirect_when_extracting_discovered_articles(self):
        adapter = XinhuaAdapter(delay_seconds=0, follow_redirects=False)
        adapter.session.get = MagicMock(return_value=MagicMock(status_code=302))
        self.assertIsNone(adapter._parse_article("https://www.news.cn/a.html"))
        self.assertFalse(adapter.session.get.call_args.kwargs["allow_redirects"])
        adapter.session.close()


if __name__ == "__main__":
    unittest.main()
