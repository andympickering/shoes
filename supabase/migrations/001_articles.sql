-- Enable PGroonga for Chinese/multilingual full-text search
create extension if not exists pgroonga with schema extensions;

-- Articles table (renamed to chnscraping_articles by migration 003)
create table public.articles (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  headline text not null,
  story_text text not null,
  url text not null unique,
  published_at timestamptz,
  scraped_at timestamptz not null default now(),
  display_date timestamptz not null generated always as (coalesce(published_at, scraped_at)) stored,
  search_text text not null generated always as (headline || ' ' || story_text) stored,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

-- PGroonga full-text search index (index expression must be a column)
create index ix_articles_search on public.articles using pgroonga (search_text);

-- Optional: separate indexes if you want to search headline vs body independently
create index ix_articles_headline on public.articles using pgroonga (headline);
create index ix_articles_story_text on public.articles using pgroonga (story_text);

-- RLS: allow public read for search (anon key), service role has full access
alter table public.articles enable row level security;

create policy "Allow public read access" on public.articles
  for select using (true);

create policy "Service role full access" on public.articles
  for all using (auth.role() = 'service_role');

-- Index for filtering by source and date
create index ix_articles_source on public.articles (source);
create index ix_articles_display_date on public.articles (display_date desc);

-- RPC for PGroonga full-text search (supports Chinese)
create or replace function public.search_articles(
  search_query text,
  filter_source text default null,
  result_limit int default 20
)
returns table (
  id uuid,
  source text,
  headline text,
  story_text text,
  url text,
  display_date timestamptz,
  snippet text
)
language sql
stable
as $$
  select
    a.id,
    a.source,
    a.headline,
    a.story_text,
    a.url,
    a.display_date,
    left(a.story_text, 200) as snippet
  from public.articles a
  where
    (filter_source is null or a.source = filter_source)
    and a.search_text &@~ search_query
  order by a.display_date desc
  limit result_limit;
$$;
