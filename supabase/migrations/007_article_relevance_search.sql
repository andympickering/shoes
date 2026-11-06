create or replace function public.chnscraping_evaluate_article_search(
  search_expression jsonb,
  article_headline text,
  article_story text,
  headline_only boolean
)
returns table (matches boolean, relevance_score integer)
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  expression_type text;
  term text;
  lowered_term text;
  lowered_headline text;
  lowered_story text;
  search_position integer;
  occurrence_position integer;
  headline_count integer;
  story_count integer;
  left_matches boolean;
  left_score integer;
  right_matches boolean;
  right_score integer;
begin
  if search_expression is null then
    return query select true, 0;
    return;
  end if;

  if jsonb_typeof(search_expression) <> 'object' then
    raise exception 'Search expression nodes must be objects' using errcode = '22023';
  end if;

  expression_type := search_expression->>'type';

  if expression_type = 'term' then
    term := btrim(search_expression->>'value');
    if term is null or term = '' then
      raise exception 'Search terms cannot be empty' using errcode = '22023';
    end if;

    lowered_term := lower(term);
    lowered_headline := lower(coalesce(article_headline, ''));
    lowered_story := lower(coalesce(article_story, ''));

    headline_count := 0;
    search_position := 1;
    loop
      occurrence_position := strpos(substr(lowered_headline, search_position), lowered_term);
      exit when occurrence_position = 0;
      headline_count := headline_count + 1;
      search_position := search_position + occurrence_position + length(lowered_term) - 1;
    end loop;

    story_count := 0;
    if not headline_only then
      search_position := 1;
      loop
        occurrence_position := strpos(substr(lowered_story, search_position), lowered_term);
        exit when occurrence_position = 0;
        story_count := story_count + 1;
        search_position := search_position + occurrence_position + length(lowered_term) - 1;
      end loop;
    end if;

    return query
      select headline_count + story_count > 0,
             least(headline_count, 5) * 5 + least(story_count, 10);
    return;
  end if;

  if expression_type not in ('and', 'or') then
    raise exception 'Unsupported search expression node: %', expression_type
      using errcode = '22023';
  end if;
  if not (search_expression ? 'left') or not (search_expression ? 'right') then
    raise exception 'Boolean expressions require left and right operands'
      using errcode = '22023';
  end if;

  select evaluation.matches, evaluation.relevance_score
    into left_matches, left_score
    from public.chnscraping_evaluate_article_search(
      search_expression->'left', article_headline, article_story, headline_only
    ) as evaluation;
  select evaluation.matches, evaluation.relevance_score
    into right_matches, right_score
    from public.chnscraping_evaluate_article_search(
      search_expression->'right', article_headline, article_story, headline_only
    ) as evaluation;

  if expression_type = 'and' then
    return query
      select left_matches and right_matches,
             case when left_matches and right_matches then left_score + right_score else 0 end;
  else
    return query
      select left_matches or right_matches,
             (case when left_matches then left_score else 0 end)
             + (case when right_matches then right_score else 0 end);
  end if;
end;
$$;

create or replace function public.chnscraping_list_articles(
  search_expression jsonb default null,
  search_headline_only boolean default false,
  filter_source text default null,
  published_from timestamptz default null,
  published_to_exclusive timestamptz default null,
  result_page integer default 1,
  result_page_size integer default 50
)
returns table (
  id uuid,
  source text,
  headline text,
  display_date timestamptz,
  relevance_score integer,
  total_count bigint
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if result_page is null or result_page < 1 then
    raise exception 'Result page must be a positive integer' using errcode = '22023';
  end if;
  if result_page_size is null or result_page_size < 1 or result_page_size > 100 then
    raise exception 'Result page size must be between 1 and 100' using errcode = '22023';
  end if;
  if search_headline_only is null then
    raise exception 'Headline-only setting cannot be null' using errcode = '22023';
  end if;

  return query
  with filtered_articles as (
    select article.id, article.source, article.headline, article.story_text, article.display_date
    from public.chnscraping_articles as article
    where (filter_source is null or article.source = filter_source)
      and (published_from is null or article.display_date >= published_from)
      and (published_to_exclusive is null or article.display_date < published_to_exclusive)
  ),
  evaluated_articles as (
    select
      article.id,
      article.source,
      article.headline,
      article.display_date,
      evaluation.matches,
      evaluation.relevance_score
    from filtered_articles as article
    cross join lateral public.chnscraping_evaluate_article_search(
      search_expression,
      article.headline,
      article.story_text,
      search_headline_only
    ) as evaluation
  ),
  matching_articles as (
    select article.id, article.source, article.headline, article.display_date, article.relevance_score
    from evaluated_articles as article
    where article.matches
  )
  select
    article.id,
    article.source,
    article.headline,
    article.display_date,
    article.relevance_score,
    count(*) over () as total_count
  from matching_articles as article
  order by article.relevance_score desc, article.display_date desc, article.id
  limit result_page_size
  offset (result_page - 1) * result_page_size;
end;
$$;

revoke all on function public.chnscraping_evaluate_article_search(jsonb, text, text, boolean) from public;
revoke all on function public.chnscraping_list_articles(jsonb, boolean, text, timestamptz, timestamptz, integer, integer) from public;
grant execute on function public.chnscraping_evaluate_article_search(jsonb, text, text, boolean) to anon, authenticated;
grant execute on function public.chnscraping_list_articles(jsonb, boolean, text, timestamptz, timestamptz, integer, integer) to anon, authenticated;
