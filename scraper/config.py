"""Configuration for the Chinese news scraper."""
import os
from dataclasses import dataclass


@dataclass
class Config:
    """Scraper configuration from environment variables."""

    supabase_url: str
    supabase_service_key: str
    request_delay_seconds: float = 3.0

    @classmethod
    def from_env(cls) -> "Config":
        url = (os.environ.get("SUPABASE_URL") or "").strip()
        key = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()
        if not url or not key:
            raise ValueError(
                "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in environment"
            )
        delay = float(os.environ.get("SCRAPER_DELAY_SECONDS", "3.0"))
        return cls(
            supabase_url=url,
            supabase_service_key=key,
            request_delay_seconds=delay,
        )
