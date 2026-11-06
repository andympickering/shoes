-- Prefix the remaining application tables. Renaming preserves their data,
-- constraints, indexes, policies, and foreign-key relationships.
do $$
declare
  table_name text;
  prefixed_table_name text;
  table_names text[] := array[
    'crawl_jobs',
    'article_urls',
    'article_versions',
    'discovery_records'
  ];
begin
  foreach table_name in array table_names loop
    prefixed_table_name := 'chnscraping_' || table_name;

    if to_regclass(format('public.%I', table_name)) is not null then
      if to_regclass(format('public.%I', prefixed_table_name)) is not null then
        raise exception
          'Both public.% and public.% exist; resolve the duplicate tables before continuing',
          table_name,
          prefixed_table_name;
      end if;

      execute format(
        'alter table public.%I rename to %I',
        table_name,
        prefixed_table_name
      );
    elsif to_regclass(format('public.%I', prefixed_table_name)) is null then
      raise exception
        'Neither public.% nor public.% exists',
        table_name,
        prefixed_table_name;
    end if;
  end loop;
end;
$$;
