"""Beijing News (新京报 / bjnews.com.cn) adapter."""
import re
import time
from datetime import datetime
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from .base import Article, BaseAdapter


class BjnewsAdapter(BaseAdapter):
    """Scraper for Beijing News / 新京报 (www.bjnews.com.cn)."""

    source_id = "bjnews"
    USER_AGENT = "CHNscraping article extraction; contact repository owner"

    LISTING_URLS = [
        "https://www.bjnews.com.cn/",
    ]

    # Match article URLs: bjnews.com.cn/detail/number.html
    ARTICLE_URL_PATTERN = re.compile(
        r"bjnews\.com\.cn/detail/\d+\.html$",
        re.I,
    )

    def __init__(self, delay_seconds: float = 3.0, user_agent: str | None = None):
        self.delay_seconds = delay_seconds
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": user_agent or self.USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            }
        )

    def _get_article_urls(self) -> set[str]:
        """Extract article URLs from listing pages."""
        urls = set()
        for listing_url in self.LISTING_URLS:
            try:
                resp = self.session.get(listing_url, timeout=15)
                resp.raise_for_status()
                resp.encoding = resp.apparent_encoding or "utf-8"
                soup = BeautifulSoup(resp.text, "html.parser")
                for a in soup.find_all("a", href=True):
                    href = a["href"]
                    if self.ARTICLE_URL_PATTERN.search(href):
                        full_url = urljoin(listing_url, href)
                        parsed = urlparse(full_url)
                        if "bjnews.com.cn" in parsed.netloc:
                            urls.add(full_url)
            except Exception as e:
                print(f"Warning: failed to fetch {listing_url}: {e}")
            time.sleep(self.delay_seconds)
        return urls

    def _parse_article(self, url: str) -> Article | None:
        """Fetch and parse a single article page."""
        try:
            resp = self.session.get(url, timeout=15)
            resp.raise_for_status()
            resp.encoding = resp.apparent_encoding or "utf-8"
            soup = BeautifulSoup(resp.text, "html.parser")

            h1 = soup.find("h1")
            headline = h1.get_text(strip=True) if h1 else ""
            if not headline:
                title_tag = soup.find("title")
                if title_tag:
                    headline = title_tag.get_text(strip=True).split("—")[0].split("-")[0].strip()
            if not headline:
                return None

            published_at = None
            timer = soup.select_one(".timer")
            if timer:
                try:
                    published_at = datetime.strptime(
                        timer.get_text(strip=True), "%Y-%m-%d %H:%M"
                    )
                except ValueError:
                    pass
            if not published_at:
                date_match = re.search(
                    r"(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})",
                    resp.text,
                )
                if date_match:
                    try:
                        published_at = datetime(
                            int(date_match.group(1)),
                            int(date_match.group(2)),
                            int(date_match.group(3)),
                            int(date_match.group(4)),
                            int(date_match.group(5)),
                            0,
                        )
                    except ValueError:
                        pass

            story_parts = []
            content_selectors = [
                "div#contentStr p",
                "div.article-content p",
                "div#content p",
                "div.content p",
                "article p",
            ]
            for selector in content_selectors:
                paras = soup.select(selector)
                if paras:
                    for p in paras:
                        text = p.get_text(strip=True)
                        if text and len(text) > 15:
                            story_parts.append(text)
                    break
            if not story_parts:
                main = soup.find("div", class_=re.compile(r"content|article|detail"))
                if main:
                    for p in main.find_all("p"):
                        text = p.get_text(strip=True)
                        if text and len(text) > 15:
                            story_parts.append(text)
            story_text = "\n\n".join(story_parts) if story_parts else headline

            return Article(
                headline=headline,
                story_text=story_text,
                url=url,
                published_at=published_at,
            )
        except Exception as e:
            print(f"Warning: failed to parse {url}: {e}")
            return None

    def fetch_articles(self) -> list[Article]:
        """Fetch articles from Beijing News."""
        articles = []
        urls = self._get_article_urls()
        for url in list(urls)[:25]:
            article = self._parse_article(url)
            if article:
                articles.append(article)
            time.sleep(self.delay_seconds)
        return articles
