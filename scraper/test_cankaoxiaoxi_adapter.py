import unittest
from unittest.mock import MagicMock

from .adapters.cankaoxiaoxi import CankaoxiaoxiAdapter


class CankaoxiaoxiAdapterTests(unittest.TestCase):
    def test_extracts_embedded_body_and_beijing_publication_time(self):
        adapter = CankaoxiaoxiAdapter(delay_seconds=0)
        response = MagicMock(status_code=200)
        response.apparent_encoding = "utf-8"
        response.text = r"""
        <html>
          <head><title>测试标题</title>
            <meta property="article:published_time" content="2026-11-19">
          </head>
          <body>
            <span id="publishTimeStr" value="2026-11-19 16:26:21"></span>
            <div id="articleContent"></div>
            <script>var contentTxt = "<p>第一段内容。</p><p>第二段内容。</p>";</script>
          </body>
        </html>
        """
        adapter.session.get = MagicMock(return_value=response)

        article = adapter._parse_article(
            "https://ckxxapp.ckxx.net/pages/2026/11/19/"
            "c28eb8dcf8d348a4a4c35a4a1999edb3.html"
        )

        self.assertIsNotNone(article)
        self.assertEqual(article.headline, "测试标题")
        self.assertEqual(article.story_text, "第一段内容。\n\n第二段内容。")
        self.assertEqual(article.published_at.isoformat(), "2026-11-19T16:26:21+08:00")
        self.assertEqual(
            adapter.session.get.call_args.kwargs["allow_redirects"], True
        )
        adapter.session.close()

    def test_refuses_redirect_when_extracting_discovered_articles(self):
        adapter = CankaoxiaoxiAdapter(delay_seconds=0, follow_redirects=False)
        adapter.session.get = MagicMock(return_value=MagicMock(status_code=302))

        self.assertIsNone(adapter._parse_article(
            "https://ckxxapp.ckxx.net/pages/2026/11/19/"
            "c28eb8dcf8d348a4a4c35a4a1999edb3.html"
        ))

        self.assertFalse(adapter.session.get.call_args.kwargs["allow_redirects"])
        adapter.session.close()

    def test_rejects_urls_outside_article_path(self):
        adapter = CankaoxiaoxiAdapter(delay_seconds=0)
        adapter.session.get = MagicMock()

        self.assertIsNone(adapter._parse_article("https://example.com/article.html"))

        adapter.session.get.assert_not_called()
        adapter.session.close()


if __name__ == "__main__":
    unittest.main()
