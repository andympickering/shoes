-- Rename the original articles table after the ingestion schema migration.
-- The fallback also handles a partially applied older migration that created
-- the misspelled chnscrap table before failing on its indexes.
do $$
begin
  if to_regclass('public.chnscraping_articles') is not null then
    if to_regclass('public.articles') is not null
      or to_regclass('public.chnscrap') is not null then
      raise exception
        'Both chnscraping_articles and a legacy articles table exist; resolve the duplicate tables before continuing';
    end if;
  elsif to_regclass('public.articles') is not null then
    if to_regclass('public.chnscrap') is not null then
      raise exception
        'Both public.articles and public.chnscrap exist; resolve the duplicate tables before continuing';
    end if;
    alter table public.articles rename to chnscraping_articles;
  elsif to_regclass('public.chnscrap') is not null then
    alter table public.chnscrap rename to chnscraping_articles;
  else
    raise exception
      'No existing public.articles or public.chnscrap table found to rename';
  end if;
end;
$$;

-- SQL-language function bodies are not rewritten when a referenced table is
-- renamed, so recreate the search RPC against the new table name.
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
  from public.chnscraping_articles a
  where
    (filter_source is null or a.source = filter_source)
    and a.search_text &@~ search_query
  order by a.display_date desc
  limit result_limit;
$$;
