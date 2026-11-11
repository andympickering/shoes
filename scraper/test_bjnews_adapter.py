import unittest
from datetime import datetime
from unittest.mock import MagicMock

from .adapters.bjnews import BjnewsAdapter


class BjnewsAdapterTests(unittest.TestCase):
    def test_extracts_headline_timer_and_contentstr_body(self):
        adapter = BjnewsAdapter(delay_seconds=0)
        response = MagicMock()
        response.text = """
        <html>
          <head><title>Headline — 新京报</title></head>
          <body>
            <p>Unrelated page text 2020-01-01 01:02</p>
            <div class="bodyTitle">
              <h1>Headline</h1>
              <span class="timer">2026-11-11 22:34</span>
            </div>
            <div id="contentStr">
              <div class="content-name">
                <p>This is the article paragraph and contains enough text.</p>
                <p>This is another paragraph from the article body.</p>
              </div>
            </div>
            <div><p>This unrelated paragraph must not be included.</p></div>
          </body>
        </html>
        """
        response.apparent_encoding = "utf-8"
        adapter.session = MagicMock()
        adapter.session.get.return_value = response

        article = adapter._parse_article("https://www.bjnews.com.cn/detail/123.html")

        self.assertIsNotNone(article)
        self.assertEqual(article.headline, "Headline")
        self.assertEqual(article.published_at, datetime(2026, 11, 11, 22, 34))
        self.assertEqual(
            article.story_text,
            "This is the article paragraph and contains enough text.\n\n"
            "This is another paragraph from the article body.",
        )


if __name__ == "__main__":
    unittest.main()
