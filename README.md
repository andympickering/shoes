# Project

Source code and supporting files for a software project.

Guangming Online (`gmw`) uses daily sitemap discovery, followed by queued
article extraction and the shared email alert workflow. Discovery reads the
sitemaps advertised by `https://www.gmw.cn/robots.txt`; both discovery and
extraction check each host's robots rules and crawl delay. Redirected articles
are not fetched without a separate robots check. To run these stages manually:

```bash
python -m scraper.sitemap_discovery --source gmw
python -m scraper.scrape_pending --source gmw
```

The shared alert workflow waits for successful People's Daily, Beijing News,
and Guangming Online extractions on the same UTC day.

Cankaoxiaoxi (`cankaoxiaoxi`) uses its public keyword-search API to discover
articles matching active alert terms from the previous 24 hours, then extracts
the queued article pages. The daily/manual GitHub Actions workflow runs both
stages. To run them locally:

```bash
python -m scraper.cankaoxiaoxi_search_discovery
python -m scraper.scrape_pending --source cankaoxiaoxi
```
