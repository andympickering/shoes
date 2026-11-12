drop policy if exists "Allow public read access"
  on public.chnscraping_articles;

create policy "Authenticated read access"
  on public.chnscraping_articles
  for select
  to authenticated
  using (true);

revoke all on table public.chnscraping_articles from public, anon;
grant select on table public.chnscraping_articles to authenticated, service_role;

revoke all on function public.search_articles(text, text, integer)
  from public, anon;
grant execute on function public.search_articles(text, text, integer)
  to authenticated, service_role;

revoke all on function public.chnscraping_evaluate_article_search(
  jsonb, text, text, boolean
) from public, anon;
grant execute on function public.chnscraping_evaluate_article_search(
  jsonb, text, text, boolean
) to authenticated, service_role;

revoke all on function public.chnscraping_list_articles(
  jsonb, boolean, text, timestamptz, timestamptz, integer, integer
) from public, anon;
grant execute on function public.chnscraping_list_articles(
  jsonb, boolean, text, timestamptz, timestamptz, integer, integer
) to authenticated, service_role;
