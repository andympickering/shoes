# Chinese News Archive: Project Plan

## Goal

Build a searchable, durable archive of articles from People's Daily (人民网),
Caixin (财新网), and The Beijing News (新京报). Collect recent articles
reliably while progressively discovering and processing the accessible historical
archive. Preserve article provenance and handle URL changes and article edits
without silently losing records.

## Guiding approach

- Treat historical backfill and daily ingestion as independent workflows that
  share adapters, persistence, validation, and deduplication.
- Separate URL discovery from article extraction. Keep a record of discovered
  URLs even when extraction fails, access is restricted, or an article is no
  longer available.
- Work source by source. Verify each publisher's archive structure, access
  conditions, robots rules, and permitted request rate before expanding its
  crawler.
- Extend the existing Python adapters, Supabase/PostgreSQL database, PGroonga
  search, Next.js UI, and GitHub Actions schedule first. Evaluate new
  infrastructure only when measured requirements justify it.
- Do not automatically combine similar articles across publishers or merge
  fuzzy content matches. A publication's version of a story is its own record.
- Preserve original Chinese text and distinguish publisher publication time
  from discovery, collection, and update times.

## Current starting point

The repository already has:

- Python adapters for the three target sources.
- A Supabase `chnscraping_articles` table with a unique URL, PGroonga search,
  and a search RPC.
- A Next.js search page and a Python search CLI.
- A GitHub Actions workflow scheduled daily at 02:00 UTC, with manual dispatch.

The current scraper discovers links from each source's homepage, processes at
most 25 URLs per source per run, and inserts articles using URL-only
deduplication. It does not yet have durable discovery records, historical date
batches, extraction retries, article versions, or coverage reporting. The
current workflow is therefore a daily starter, not yet a complete daily archive
pipeline or historical backfill system.

## Target workflow

### Daily ingestion

1. Run once per day; keep the existing manual trigger for recovery and testing.
2. Discover articles from recent source pages, sitemaps, and other verified
   discovery routes, revisiting a rolling seven-day window to catch delayed
   listings and missed runs. For People's Daily, evaluate the RSS 2.0 feed
   `https://plink.anyfeeder.com/people-daily` as an additional recent-article
   source, not a replacement for publisher sitemaps.
3. Persist every newly discovered URL and its source, discovery method, and
   discovery time before extraction.
4. Extract pending URLs using source-specific adapters, validation, and
   bounded retries.
5. Apply shared deduplication and article-version rules, then store results.
6. Report per-source discovered, inserted, updated, duplicate, failed, and
   deferred counts. A source failure must be visible and must not be reported
   as a successful complete run.

### Historical backfill

1. Inventory source-specific discovery routes and identify the oldest
   accessible periods; do not assume the three sources have the same coverage.
   Treat rolling RSS feeds as recent-discovery aids unless testing establishes
   that they retain historical items.
2. Create resumable date-range batches, initially monthly (split into weeks
   where volume or source behavior requires it).
3. Discover and persist candidate URLs for a batch before considering it
   complete.
4. Process candidates at a conservative, permitted rate. Keep daily work
   higher priority while ensuring backfill continues to make progress.
5. Checkpoint batch status and counts in the database. Retry eligible failures
   and retain unavailable/restricted outcomes for reporting.
6. Measure discovery and extraction coverage separately. Mark a batch complete
   only when discovery has been exhausted and all candidates have a terminal
   state or an explicitly recorded exception.

Daily collection should begin before the backfill is finished so the recent
archive does not keep growing uncollected.

## Data and identity model

Evolve the existing schema incrementally, retaining `chnscraping_articles` as
the canonical record for one article as published by one source.

### Article identity and deduplication

For each article, retain the original discovered/extracted URL and, when
available, the publisher's article ID and canonical URL. Resolve possible
duplicates in this order:

1. Publisher article ID, scoped to its source.
2. Canonical and normalized URL, scoped to its source.
3. SHA-256 fingerprint of normalized headline and body, scoped to its source.
4. Similarity checks may identify review candidates but must not auto-merge
   records.

URL normalization should remove fragments and known tracking parameters,
standardize equivalent host forms where safe, and preserve the original URL.
Store URL aliases/history separately so a redirect or changed canonical URL
does not erase provenance. Add database uniqueness constraints for stable
identifiers and normalized URLs where the schema supports them.

### Persistence capabilities to add

- A discovery/URL record with source, URL, normalized URL, discovery method,
  first/last seen times, and processing state.
- Crawl/backfill job and date-batch records with status, checkpoints, timestamps,
  and per-state counts.
- Article source identifier, canonical URL, content fingerprint, and separate
  publication/first-collected/last-checked timestamps.
- Article versions that retain changed headline/body content instead of
  overwriting prior observations.
- Extraction/error details sufficient to retry and diagnose failures without
  logging credentials.
- RSS item GUID, title, and publication date may be retained as discovery
  metadata when available, but a GUID is not a publisher article ID unless its
  stability and uniqueness are verified.

Preserve the publication's original date string where practical, plus a parsed
timestamp and explicit timezone interpretation. Do not substitute scrape time
for an unknown publication date without marking the distinction.

## Phased implementation

### Phase 1 — Source and behavior baseline

- Verify each domain and relevant subdomain's robots rules, terms/access
  conditions, sitemap references, archive/search routes, request limits, and
  historical accessibility.
- Verify the People's Daily RSS feed's operator, terms, item retention,
  update cadence, and link/date accuracy. Its description indicates full-text
  feed content; use it initially for URL and metadata discovery only, then
  extract from the publisher page under the applicable access rules.
- Confirm each adapter targets the intended People's Daily property and
  document source-specific URL patterns and extraction limitations.
- Add fixture-based tests for representative listing and article pages,
  including missing/invalid dates and extraction failures.
- Capture baseline results from a small permitted sample per source.

**Exit criteria:** documented discovery routes and constraints for all sources;
repeatable adapter tests; no source is treated as complete based only on its
homepage.

### Phase 2 — Durable discovery, identity, and schema

- Design and apply additive Supabase migrations for discovery records, URL
  history, job/batch tracking, identity fields, and article versions.
- Introduce normalized URL and content-fingerprint helpers with unit tests.
- Make article writes idempotent using the identity hierarchy and database
  constraints; preserve separate publisher records.
- Keep migration and data backfill steps safe for existing rows whose URL is
  already unique.

**Exit criteria:** repeated imports do not create duplicate rows; changed URLs
can be associated with an existing article when a stable identity matches;
edits can be retained as versions.

### Phase 3 — Reliable daily ingestion

- Replace homepage-only discovery with the verified recent discovery routes for
  each source.
- Add the People's Daily RSS feed as a supplementary discovery adapter. Save
  feed-discovered article URLs in `chnscraping_discovery_records` with
  `discovery_method = 'rss'` and `discovered_from_url` set to the feed URL.
  Treat item titles and dates as hints to validate during publisher-page
  extraction; do not depend on the feed as the article archive or persist its
  full-text payload as a substitute for publisher extraction.
- Persist candidates before extraction; add bounded retries, timeouts, and
  explicit terminal statuses.
- Revisit a seven-day recent window and make failures visible in the job report.
- Keep the scheduled and manual GitHub Actions paths, with secrets supplied
  only through repository secrets.

**Exit criteria:** repeat runs are idempotent; a missed or failed run can recover
from persisted state; a source failure is visible; daily candidates are not
silently dropped.

### Phase 4 — Controlled historical backfill

- Build a command/workflow to create and run source-specific monthly batches.
- Start with one representative month per source, measure discovered versus
  extracted counts, and refine source-specific parsing before scaling.
- Add resumability, bounded retries, per-source rate limits, job summaries, and
  fair scheduling with daily work.
- Expand the date range progressively based on verified coverage and allowed
  access, not an assumed article count or fixed one-month deadline.

**Exit criteria:** interrupted batches resume without loss or duplicate
insertion; each candidate has a recorded state; progress and coverage can be
reported by source and date range.

### Phase 5 — Search and operational hardening

- Validate Chinese-language search quality, source/date filters, snippets, and
  result ordering against a representative corpus.
- Keep PGroonga as the initial search solution; evaluate OpenSearch only if
  measured scale or search requirements exceed the current database approach.
- Remove silent success-shaped fallback behavior in search and ingestion paths;
  surface operational errors and distinguish unavailable search capability
  from no results.
- Add monitoring/notifications appropriate to the deployment and document
  recovery, migration, and manual-run procedures.

**Exit criteria:** search remains usable as the archive grows; operators can
identify failed runs and recover them; required tests and build checks pass.

## Initial technical choices

| Area | Initial choice |
|---|---|
| Scraping and orchestration | Existing Python project and source adapters |
| Persistence | Existing Supabase-hosted PostgreSQL |
| Search | Existing PGroonga RPC; benchmark before replacing |
| Daily schedule | Existing GitHub Actions schedule and manual dispatch |
| Backfill state | Database-backed batches and discovered-URL queue |
| Historical cadence | Monthly batches initially, split as evidence requires |
| New infrastructure | No Redis, Celery, OpenSearch, or object storage until a
  demonstrated need justifies the operational cost |

Scrapy, a dedicated task queue, or external search infrastructure may be
reconsidered after measuring URL volume, runtime, retry needs, and search
performance. They are options, not prerequisites for the first reliable
version.

## Quality, safety, and acceptance checks

- Test each adapter against saved fixtures; do not rely on live sites for the
  core test suite.
- Test URL normalization, source-scoped identity, duplicate insert behavior,
  edited-article versioning, date parsing, retry transitions, and resumable
  batches.
- Provide a dry-run path and ensure it does not write to Supabase.
- Enforce publisher-specific delays and access rules; do not bypass paywalls,
  authentication, CAPTCHAs, or other access controls.
- Keep service-role credentials on backend/automation paths only; never expose
  them to the browser. Keep secrets out of logs and committed files.
- Treat full-text retention and redistribution as separate questions; review
  applicable publisher terms, copyright/licensing, and intended use before
  making archived text public.
- Report coverage as discovered, extracted, failed, restricted, and unresolved
  counts; article totals alone are not a completeness measure.

## Decisions to confirm during implementation

- The earliest desired date range for each publisher, based on accessible
  archives rather than assumption.
- Whether full article text is intended to be private research data or publicly
  displayed/redistributed.
- Which deployment/notification channel should alert on failed daily runs.
- Whether a later scale milestone warrants Scrapy, a separate queue, or a
  dedicated search service.
