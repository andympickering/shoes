-- Extend the existing articles table while preserving its current search API.
alter table public.articles
  add column if not exists publisher_article_id text,
  add column if not exists canonical_url text,
  add column if not exists content_hash text,
  add column if not exists author text,
  add column if not exists section text,
  add column if not exists language text,
  add column if not exists source_published_at text,
  add column if not exists first_collected_at timestamptz,
  add column if not exists last_checked_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.articles
set
  first_collected_at = coalesce(first_collected_at, scraped_at, created_at),
  last_checked_at = coalesce(last_checked_at, scraped_at, created_at),
  updated_at = coalesce(updated_at, created_at, now());

alter table public.articles
  alter column first_collected_at set default now(),
  alter column first_collected_at set not null,
  alter column last_checked_at set default now(),
  alter column last_checked_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

create unique index if not exists uq_articles_source_publisher_article_id
  on public.articles (source, publisher_article_id)
  where publisher_article_id is not null;

create unique index if not exists uq_articles_source_content_hash
  on public.articles (source, content_hash)
  where content_hash is not null;

create table if not exists public.crawl_jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  job_type text not null check (job_type in ('backfill', 'daily', 'manual')),
  date_from date,
  date_to date,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'partial', 'failed')),
  discovered_count integer not null default 0 check (discovered_count >= 0),
  extracted_count integer not null default 0 check (extracted_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  restricted_count integer not null default 0 check (restricted_count >= 0),
  last_processed_url text,
  error_summary text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crawl_jobs_valid_date_range
    check (date_from is null or date_to is null or date_from <= date_to)
);

create index if not exists ix_crawl_jobs_source_status_created
  on public.crawl_jobs (source, status, created_at desc);

create table if not exists public.article_urls (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles (id) on delete cascade,
  source text not null,
  url text not null,
  normalized_url text not null,
  url_type text not null default 'discovered'
    check (url_type in ('original', 'canonical', 'redirect', 'alias', 'discovered')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint article_urls_source_normalized_url_key
    unique (source, normalized_url)
);

create index if not exists ix_article_urls_article_id
  on public.article_urls (article_id);

-- Existing URLs are retained as captured. New normalized URLs should be
-- normalized by the ingestion code before they are written.
insert into public.article_urls (
  article_id,
  source,
  url,
  normalized_url,
  url_type,
  first_seen_at,
  last_seen_at
)
select
  a.id,
  a.source,
  a.url,
  a.url,
  'original',
  coalesce(a.scraped_at, a.created_at),
  coalesce(a.scraped_at, a.created_at)
from public.articles a
on conflict (source, normalized_url) do nothing;

create table if not exists public.article_versions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles (id) on delete cascade,
  version_number integer not null check (version_number > 0),
  headline text not null,
  story_text text not null,
  content_hash text,
  published_at timestamptz,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint article_versions_article_version_key
    unique (article_id, version_number),
  constraint article_versions_article_hash_key
    unique (article_id, content_hash)
);

create index if not exists ix_article_versions_article_observed
  on public.article_versions (article_id, observed_at desc);

insert into public.article_versions (
  article_id,
  version_number,
  headline,
  story_text,
  content_hash,
  published_at,
  observed_at
)
select
  a.id,
  1,
  a.headline,
  a.story_text,
  a.content_hash,
  a.published_at,
  coalesce(a.scraped_at, a.created_at)
from public.articles a
on conflict (article_id, version_number) do nothing;

create table if not exists public.discovery_records (
  id uuid primary key default gen_random_uuid(),
  crawl_job_id uuid references public.crawl_jobs (id) on delete set null,
  article_id uuid references public.articles (id) on delete set null,
  source text not null,
  discovered_url text not null,
  normalized_url text not null,
  discovery_method text not null,
  processing_status text not null default 'pending'
    check (processing_status in (
      'pending',
      'queued',
      'processing',
      'processed',
      'duplicate',
      'failed',
      'unavailable',
      'restricted'
    )),
  discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discovery_records_source_url_method_key
    unique (source, normalized_url, discovery_method)
);

create index if not exists ix_discovery_records_status_seen
  on public.discovery_records (processing_status, last_seen_at);

create index if not exists ix_discovery_records_job_status
  on public.discovery_records (crawl_job_id, processing_status);

create index if not exists ix_discovery_records_article_id
  on public.discovery_records (article_id);

-- Seed discovery state for records that predate this migration. This marks
-- their provenance as a migration import rather than inventing a crawl method.
insert into public.discovery_records (
  article_id,
  source,
  discovered_url,
  normalized_url,
  discovery_method,
  processing_status,
  discovered_at,
  last_seen_at
)
select
  a.id,
  a.source,
  a.url,
  a.url,
  'legacy_migration',
  'processed',
  coalesce(a.scraped_at, a.created_at),
  coalesce(a.scraped_at, a.created_at)
from public.articles a
on conflict (source, normalized_url, discovery_method) do nothing;

alter table public.article_urls enable row level security;
alter table public.article_versions enable row level security;
alter table public.discovery_records enable row level security;
alter table public.crawl_jobs enable row level security;
