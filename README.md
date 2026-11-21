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

Archive search and alert results share a relevance ranking calculated at search
time, including for previously scraped articles. For each search term, the body
score is the number of occurrences per 1,000 story characters, with no match
cap. Stories shorter than 80 characters contribute no body score, but can
still match. Character counts include Chinese and non-Chinese text, punctuation,
and whitespace. Headline matches contribute 5 points each, up to 25 per term;
headline-only searches use that bonus without a story-length cutoff. The archive
displays scores to two decimal places while ranking uses unrounded scores.

Cankaoxiaoxi (`cankaoxiaoxi`) uses its public keyword-search API to discover
articles matching active alert terms from the previous 48 hours, then extracts
the queued article pages. GitHub Actions runs both stages. To run them locally:

```bash
python -m scraper.cankaoxiaoxi_search_discovery
python -m scraper.scrape_pending --source cankaoxiaoxi
```

## Discovery scheduling

Supabase Cron dispatches `.github/workflows/discovery-scheduler.yml` daily at
12:47 UTC. GitHub Actions still runs the discovery workflows and scrapers; only
the timer is hosted by Supabase. The scheduler checks recent crawl history and
active workflow runs before dispatching each due discovery.

Before applying `supabase/migrations/015_supabase_discovery_schedule.sql`:

1. Create a fine-grained GitHub token restricted to this repository with
   **Actions: write** permission.
2. Store it in Supabase Vault under the name
   `github_actions_dispatch_token`. Do not put the token in this repository or
   in the migration.
3. Apply `015_supabase_discovery_schedule.sql` to the Supabase project. It
   installs the extensions and schedules the daily HTTP dispatch to `master`.
4. Apply `016_reschedule_discovery_dispatch.sql` to set the existing job to
   12:47 UTC.

If the 015 migration was already applied and the cron job is installed, apply
only migration 016; do not rerun 015.

The migration requires Supabase's `pg_cron`, `pg_net`, and Vault extensions.
It also revokes `anon` and `authenticated` access to `pg_net`'s request and
response tables because queued request headers briefly contain the dispatch
token.
To confirm the job is installed, query `cron.job` for
`chnscraping-discovery-dispatch`. To inspect recent GitHub API responses, query
`net._http_response`; a successful workflow dispatch returns HTTP 204.
Confirm `show cron.timezone;` reports `GMT` or `UTC` so the run occurs at the
intended UTC time.
Rotate the Vault token before its GitHub expiration.

The workflow remains manually runnable through GitHub Actions' **Run workflow**
button.
