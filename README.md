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
Alert emails link to the archive with the alert search and the email's UTC date
pre-filled. The archive link searches that calendar day, regardless of the
alert's configured lookback period.

Cankaoxiaoxi (`cankaoxiaoxi`) uses its public keyword-search API to discover
articles matching active alert terms from the previous 48 hours, then extracts
the queued article pages. The daily/manual GitHub Actions workflow runs both
stages. To run them locally:

```bash
python -m scraper.cankaoxiaoxi_search_discovery
python -m scraper.scrape_pending --source cankaoxiaoxi
```
