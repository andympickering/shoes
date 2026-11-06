"""Base adapter for Chinese news site scrapers."""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class Article:
    """Represents a scraped article."""

    headline: str
    story_text: str
    url: str
    published_at: Optional[datetime] = None
    metadata: Optional[dict] = None


class BaseAdapter(ABC):
    """Abstract base class for news site adapters."""

    source_id: str = "base"

    @abstractmethod
    def fetch_articles(self) -> list[Article]:
        """
        Fetch articles from the news site.
        Returns a list of Article objects.
        """
        pass
