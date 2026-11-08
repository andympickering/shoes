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
006 before running this workflow.

The `People's Daily Article Extraction` workflow starts automatically after a
successful sitemap discovery run and can also be started manually. It scrapes
up to 1,000 eligible pending records, honoring the publisher's `robots.txt`
rules and crawl delay, saving extracted articles, and updating discovery
statuses and crawl-job progress. If fetching or extracting a URL fails, it
retries once using the equivalent `.cn` or `.com.cn` hostname, upgrading an
HTTP URL to HTTPS for the retry. It checks the alternate hostname's own
`robots.txt` rules; URLs explicitly disallowed by `robots.txt` are not retried.
It may take several hours depending on the crawl delay. Individual article
extraction failures are counted and recorded without failing the workflow;
only a fatal workflow error marks the crawl job failed and returns a failing
Action result.

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
