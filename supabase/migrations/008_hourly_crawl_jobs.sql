alter table public.chnscraping_crawl_jobs
  drop constraint if exists chnscraping_crawl_jobs_job_type_check;

alter table public.chnscraping_crawl_jobs
  add constraint chnscraping_crawl_jobs_job_type_check
  check (job_type in ('backfill', 'daily', 'hourly', 'manual', 'weekly'));
