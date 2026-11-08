alter table public.chnscraping_crawl_jobs
  add column crawl_type text;

update public.chnscraping_crawl_jobs
set crawl_type = case
  when job_type in ('hourly', 'weekly') then 'discovery'
  else 'extraction'
end;

alter table public.chnscraping_crawl_jobs
  alter column crawl_type set default 'extraction',
  alter column crawl_type set not null,
  add constraint chnscraping_crawl_jobs_crawl_type_check
    check (crawl_type in ('discovery', 'extraction'));
