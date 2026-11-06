"""Xinhua (新华网) news site adapter."""
import re
import time
from datetime import datetime
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from .base import Article, BaseAdapter


class XinhuaAdapter(BaseAdapter):
    """Scraper for Xinhua News (www.news.cn / www.xinhuanet.com)."""

    source_id = "xinhua"

    # Section pages to scrape for article links
    LISTING_URLS = [
        "https://www.news.cn/",
        "https://www.news.cn/politics/index.html",
        "https://www.news.cn/world/index.html",
        "https://www.news.cn/fortune/index.htm",
    ]

    # Match article URLs (end with /c.html)
    ARTICLE_URL_PATTERN = re.compile(r"/\d{8}/[a-f0-9]+/c\.html$", re.I)

    def __init__(self, delay_seconds: float = 3.0):
        self.delay_seconds = delay_seconds
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
                        # Normalize to avoid duplicates (news.cn vs xinhuanet.com)
                        parsed = urlparse(full_url)
                        if "news.cn" in parsed.netloc or "xinhuanet.com" in parsed.netloc:
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

            # Headline - typically in h1
            h1 = soup.find("h1")
            headline = h1.get_text(strip=True) if h1 else ""
            if not headline:
                # Fallback: title tag
                title_tag = soup.find("title")
                if title_tag:
                    headline = title_tag.get_text(strip=True).split("-")[0].strip()
            if not headline:
                return None

            # Published date - look for meta or time pattern
            published_at = None
            meta_date = soup.find("meta", {"property": "article:published_time"})
            if meta_date and meta_date.get("content"):
                try:
                    published_at = datetime.fromisoformat(
                        meta_date["content"].replace("Z", "+00:00")
                    )
                except ValueError:
                    pass
            if not published_at:
                # Look for date pattern like 2026-03-18 11:07:13
                date_match = re.search(
                    r"(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})",
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
                            int(date_match.group(6)),
                        )
                    except ValueError:
                        pass

            # Article body - common content containers
            story_parts = []
            content_selectors = [
                "div#p-detail p",
                "div.detail-box p",
                "div.article p",
                "div.content p",
                "section.article-content p",
                "article p",
                "div#content p",
            ]
            for selector in content_selectors:
                paras = soup.select(selector)
                if paras:
                    for p in paras:
                        text = p.get_text(strip=True)
                        if text and len(text) > 20:
                            story_parts.append(text)
                    break
            if not story_parts:
                # Fallback: all p tags in main content area
                main = soup.find("main") or soup.find("article") or soup.find("div", class_=re.compile(r"content|detail|article"))
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
        """Fetch articles from Xinhua."""
        articles = []
        urls = self._get_article_urls()
        for url in list(urls)[:30]:  # Limit to 30 per run to avoid overload
            article = self._parse_article(url)
            if article:
                articles.append(article)
            time.sleep(self.delay_seconds)
        return articles
