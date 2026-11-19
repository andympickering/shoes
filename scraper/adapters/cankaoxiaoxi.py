"""Cankaoxiaoxi (参考消息) article adapter."""
import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import requests
from bs4 import BeautifulSoup

from .base import Article, BaseAdapter


class CankaoxiaoxiAdapter(BaseAdapter):
    """Extract articles from Cankaoxiaoxi's public article pages."""

    source_id = "cankaoxiaoxi"
    USER_AGENT = "CHNscraping article extraction; contact repository owner"
    ARTICLE_HOST = "ckxxapp.ckxx.net"
    ARTICLE_PATH_PATTERN = re.compile(
        r"/pages/\d{4}/\d{2}/\d{2}/[a-f0-9]{32}\.html$", re.IGNORECASE
    )
    CONTENT_PATTERN = re.compile(
        r'\bcontentTxt\s*=\s*("(?:\\.|[^"\\])*")\s*;', re.DOTALL
    )
    BEIJING = timezone(timedelta(hours=8))

    def __init__(
        self,
        delay_seconds: float = 3.0,
        user_agent: str | None = None,
        follow_redirects: bool = True,
    ):
        self.delay_seconds = delay_seconds
        self.follow_redirects = follow_redirects
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": user_agent or self.USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            }
        )

    def _parse_article(self, url: str) -> Article | None:
        """Fetch and parse the headline, publication time, and embedded body."""
        try:
            parts = urlsplit(url)
            if (
                parts.scheme.lower() not in ("http", "https")
                or not parts.hostname
                or parts.hostname.lower() != self.ARTICLE_HOST
                or parts.username
                or parts.password
                or not self.ARTICLE_PATH_PATTERN.fullmatch(parts.path)
            ):
                raise ValueError(f"Unsupported Cankaoxiaoxi article URL: {url}")
            response = self.session.get(
                url, timeout=15, allow_redirects=self.follow_redirects
            )
            if not self.follow_redirects and 300 <= response.status_code < 400:
                raise requests.HTTPError(f"Article URL redirected: {url}")
            response.raise_for_status()
            response.encoding = response.apparent_encoding or "utf-8"
        except (requests.RequestException, ValueError) as error:
            print(f"Warning: failed to fetch {url}: {error}")
            return None

        soup = BeautifulSoup(response.text, "html.parser")
        title_tag = soup.find("title")
        headline = title_tag.get_text(strip=True) if title_tag else ""
        if not headline:
            headline_tag = soup.find("meta", {"property": "og:title"})
            if headline_tag:
                headline = headline_tag.get("content", "").strip()
        if not headline:
            print(f"Warning: article has no headline: {url}")
            return None

        published_at = None
        time_tag = soup.find(id="publishTimeStr") or soup.select_one(".article-time")
        meta_date = soup.find("meta", {"property": "article:published_time"})
        date_values = []
        if time_tag:
            date_values.append(
                time_tag.get("value") or time_tag.get_text(strip=True)
            )
        if meta_date:
            date_values.append(meta_date.get("content", ""))
        for value in date_values:
            if not value:
                continue
            for date_format in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
                try:
                    published_at = datetime.strptime(value, date_format).replace(
                        tzinfo=self.BEIJING
                    )
                    break
                except ValueError:
                    continue
            if published_at:
                break

        content_match = self.CONTENT_PATTERN.search(response.text)
        if not content_match:
            print(f"Warning: article body is missing: {url}")
            return None
        try:
            content_html = json.loads(content_match.group(1))
        except json.JSONDecodeError as error:
            print(f"Warning: article body is invalid: {url}: {error}")
            return None
        story_text = BeautifulSoup(content_html, "html.parser").get_text(
            separator="\n\n", strip=True
        )
        if not story_text:
            print(f"Warning: article body is empty: {url}")
            return None

        return Article(
            headline=headline,
            story_text=story_text,
            url=url,
            published_at=published_at,
        )

    def fetch_articles(self) -> list[Article]:
        """Search discovery, rather than listing pages, supplies article URLs."""
        raise NotImplementedError(
            "Use cankaoxiaoxi_search_discovery and scrape_pending to fetch articles"
        )
