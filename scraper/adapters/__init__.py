"""News site adapters."""
from .base import Article, BaseAdapter
from .bjnews import BjnewsAdapter
from .caixin import CaixinAdapter
from .people import PeopleAdapter

__all__ = ["Article", "BaseAdapter", "BjnewsAdapter", "CaixinAdapter", "PeopleAdapter"]
