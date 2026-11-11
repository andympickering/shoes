# Chinese News Scraper and Search App

Scrapes Chinese news websites every 24 hours, stores headlines and story text in Supabase, and provides keyword search via web UI and CLI.

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Enable **PGroonga** extension: Dashboard → Database → Extensions → enable `pgroonga`
3. Run the migrations in order in the SQL Editor:
   - `supabase/migrations/001_articles.sql`
   - `supabase/migrations/002_archive_ingestion.sql`
   - `supabase/migrations/003_rename_articles_table.sql`
   - `supabase/migrations/004_prefix_app_tables.sql`
   - `supabase/migrations/005_discovery_source_url.sql`
   - `supabase/migrations/006_weekly_crawl_jobs.sql`
   - `supabase/migrations/007_article_relevance_search.sql`
   - `supabase/migrations/008_hourly_crawl_jobs.sql`
   - `supabase/migrations/009_crawl_type.sql`
   - `supabase/migrations/010_email_alerts.sql`
   - `supabase/migrations/011_alert_accounts.sql`
   - `supabase/migrations/012_alert_max_articles.sql`
   - `supabase/migrations/013_alert_recipient_confirmation.sql`

The second migration extends the article records with publisher IDs, content
fingerprints, and collection timestamps. It also creates URL history, article
versions, discovery records, and crawl-job tables for resumable ingestion and
backfill. The third migration renames the main table to
`chnscraping_articles` and updates the search RPC. If the first two migrations
have already been applied, apply migrations 003 and 004. Migration 004 renames
the supporting tables to use the `chnscraping_` prefix as well.
Migration 005 adds `discovered_from_url` to discovery records to retain the
sitemap or page where each article URL was found.
Migration 006 allows weekly sitemap discovery jobs to be recorded distinctly.
Migration 008 extends the allowed crawl-job types to include hourly jobs.
Migration 009 adds `crawl_type` to distinguish discovery jobs from article
extraction jobs, and classifies existing hourly/weekly jobs as discovery.
Migration 007 adds the article-list RPC used by the web app. It evaluates
boolean search expressions and ranks matches before pagination. Each matching
headline occurrence contributes 5 points (up to 5 occurrences); each matching
story-text occurrence contributes 1 point (up to 10 occurrences). For OR
expressions, matching branches contribute to the score; AND expressions score
only when both branches match. Results are ordered by score, then publication
date. No score is stored on article rows because relevance depends on the query.

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Scraper

```bash
pip install -r scraper/requirements.txt
# Use py launcher if "python" not found (e.g. Python not in PATH):
py -3.14 -m scraper.main --dry-run   # Test without DB
py -3.14 -m scraper.main              # Run full scrape
# Or: .\run-scraper.ps1 --dry-run
```

### 4. Search CLI

```bash
pip install -r search/requirements.txt
py -3.14 -m search_cli "经济" --source xinhua --limit 10
py -3.14 -m search_cli "关键词" --json
# Or: .\run-search.ps1 "经济"
```

### 5. Web App

```bash
cd web
npm install
cd ..
npm run dev
```

Open http://localhost:3000

The Next.js app reads the Supabase settings from the repository-root `.env` file.

### 6. GitHub Actions (Discovery)

Add repo secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

The `People's Daily Sitemap Discovery` workflow scans the sitemap index daily
at 17:01 UTC and can also be started manually. This is 18:01 in Rome during
CET and 19:01 during CEST. It discovers article URLs and stores new ones as
pending records; it does not extract article text. The sitemap's `robots.txt`
crawl delay is honored, so a full scan can take several hours. Apply migration
006 and migration 009 before running this workflow.

The `Beijing News Sitemap Discovery` workflow scans
`https://www.bjnews.com.cn/sitemap.xml` daily at 17:05 UTC and can also be
started manually. The sitemap is fetched directly because Beijing News'
`robots.txt` does not advertise it; the site's 5-second crawl delay is honored.
It stores new URLs as pending `bjnews` records and does not extract article
text.

The `People's Daily Article Extraction` workflow starts automatically after a
successful People's Daily sitemap discovery run and can also be started
manually. The `Beijing News Article Extraction` workflow does the same for
Beijing News. Both process up to 1,000 pending records and use the shared
`scraper.scrape_pending` pipeline with a source-specific adapter and
`robots.txt` policy. People's Daily extraction retries once using the
equivalent `.cn` or `.com.cn` hostname, upgrading an HTTP URL to HTTPS;
Beijing News uses its adapter without hostname retries. Individual article
extraction failures are counted and recorded without failing the workflow;
only a fatal workflow error marks the crawl job failed and returns a failing
Action result. The Beijing News adapter extracts headlines, `.timer`
publication timestamps, and article paragraphs under `#contentStr`.

### Email Alerts

Apply migrations `010_email_alerts.sql` through `013_alert_recipient_confirmation.sql` after the
earlier migrations. Migration 011 disables alert subscriptions created before
account ownership was introduced; recreate them after signing in. The archive
header's **Alerts** form saves search expressions, lookback windows, recipient
addresses, delivery schedules, and a maximum number of articles (1–100) in
Supabase. Existing alerts default to 25 articles, as before. The adjacent **Manage** modal
has **Alerts** and **Account** tabs for editing, pausing, resuming, or deleting
the signed-in user's subscriptions. Alert searches use the same
`AND`, `OR`, phrase, and parenthesis syntax as the archive. “Today” means since
00:00 UTC; “Last 3 days” and “Last week” are rolling 72-hour and 7-day windows.
No email is sent when there are no matching articles. Monthly schedules stay on
the day they were created (using the last day of shorter months).

Enable the Email provider in Supabase Authentication. Configure the Supabase
Site URL as the deployed HTTPS site, and add the deployed site and
`http://localhost:3000` as allowed redirect URLs. Accounts use email and
password; if email confirmation is enabled, new users must confirm their
account before signing in. Alert recipient addresses remain separate from the
account email. Each newly added alert recipient receives a confirmation email
and must confirm before receiving that alert; confirmed recipients receive it
independently of other recipients. Existing recipients are grandfathered in as
confirmed. Removing and re-adding a recipient requires confirmation again.
Pending recipients and a resend action are shown in **Manage**. Confirmation
emails are limited to five per recipient and 50 per account per hour.

Pause alert delivery while applying migration 013 and deploying the updated
web app, then resume delivery after both are in place.

Configure these environment variables in Netlify for the deployed web app:

- `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (server-side; never expose the
  service key as a `NEXT_PUBLIC_` variable)
- `RESEND_API_KEY`
- `ALERTS_FROM_EMAIL` (a sender address verified with Resend)
- `ALERTS_CRON_SECRET` (a long random secret)
- `ALERTS_SITE_URL` (the deployed site’s HTTPS URL, used for article and
  unsubscribe links)

In GitHub repository settings, add `ALERTS_CRON_SECRET` as an Actions secret
with the same value configured in Netlify, and add `ALERTS_SITE_URL` as an
Actions variable. The `Email Alert Delivery` workflow is triggered by either
publisher extraction workflow, but only sends after both have succeeded for
the same UTC run date and branch. Manual alert-delivery runs use the same
check. It calls the protected delivery endpoint until all due alerts have been
processed. An alert's configured delivery time marks when it becomes due;
delivery waits until both successful crawls finish. The form requires permission
to email the listed addresses, and every digest
includes an unsubscribe link that disables that alert.

## Project Structure

```
├── scraper/           # Python scraper
│   ├── main.py        # Entry point
│   ├── db.py          # Supabase insert logic
│   ├── config.py      # Config from env
│   └── adapters/      # Site-specific scrapers
│       ├── xinhua.py  # 新华网
│       ├── people.py  # 人民网
│       └── sina.py    # 新浪新闻
├── search/            # Shared search module
├── search_cli/        # CLI search tool
├── web/               # Next.js search UI
├── supabase/          # DB migrations
└── .github/workflows/ # Discovery workflows
```

## Supported Sites

| Site | Adapter | Source ID |
|------|---------|-----------|
| People's Daily (人民网) | people.py | people |
| Caixin (财新网) | caixin.py | caixin |
| Beijing News (新京报) | bjnews.py | bjnews |
