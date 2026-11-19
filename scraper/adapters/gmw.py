"""Guangming Online article extraction."""
from datetime import datetime, timedelta, timezone

import requests
from bs4 import BeautifulSoup

from .base import Article, BaseAdapter


class GmwAdapter(BaseAdapter):
    source_id = "gmw"
    USER_AGENT = "CHNscraping article extraction; contact repository owner"

    def __init__(self, delay_seconds: float = 3.0, user_agent: str | None = None):
        self.delay_seconds = delay_seconds
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": user_agent or self.USER_AGENT})

    def _parse_article(self, url: str) -> Article | None:
        response = self.session.get(url, timeout=15, allow_redirects=False)
        if 300 <= response.status_code < 400:
            raise requests.HTTPError(f"Article URL redirected: {url}")
        response.raise_for_status()
        soup = BeautifulSoup(response.content, "html.parser")
        title = soup.select_one("h1")
        body = soup.select_one("#ContentPh, .h-contentMain")
        if not title or not body:
            return None
        headline = title.get_text(" ", strip=True)
        paragraphs = [p.get_text(" ", strip=True) for p in body.select("p")]
        story = "\n\n".join(text for text in paragraphs if text)
        if not headline or not story:
            return None

        published_at = None
        published = soup.select_one('meta[property="article:published_time"]')
        if published and published.get("content"):
            try:
                published_at = datetime.fromisoformat(str(published["content"]).replace("Z", "+00:00"))
                if published_at.tzinfo is None:
                    published_at = published_at.replace(tzinfo=timezone(timedelta(hours=8)))
            except ValueError:
                print(f"Warning: invalid publication date for {url}")
        return Article(headline=headline, story_text=story, url=url, published_at=published_at)

    def fetch_articles(self) -> list[Article]:
        raise NotImplementedError("Guangming articles are discovered through sitemaps")
