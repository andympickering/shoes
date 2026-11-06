alter table public.chnscraping_discovery_records
  add column if not exists discovered_from_url text;
