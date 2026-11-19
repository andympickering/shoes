# Archived Xinhua ingestion

Xinhua discovery and extraction are disabled after automated search requests
received HTTP 405/403 responses. These files are retained for reference and do
not run as part of the application or GitHub Actions. Existing database records
are unchanged. The search host's robots.txt disallows automated access; resolve
access and policy requirements before considering reactivation.

The files retain their original code and imports and are not runnable from this
directory. The previous locations were:

- `xinhua-search.yml`: `.github/workflows/xinhua-search.yml`
- `xinhua_search_discovery.py`: `scraper/xinhua_search_discovery.py`
- `xinhua.py`: `scraper/adapters/xinhua.py`
- `test_xinhua_search_discovery.py.txt`: `scraper/test_xinhua_search_discovery.py`
- `test_xinhua_adapter.py.txt`: `scraper/test_xinhua_adapter.py`

Reactivation also requires restoring the Xinhua adapter in
`scraper/scrape_pending.py` and the adapter type in
`scraper/rss_discovery.py`, and reviewing the archived workflow's schedule.
The prior implementation searched active alert terms individually over the
previous 24 hours and extracted pending search records with redirects disabled.
