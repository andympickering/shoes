do $$
declare
  discovery_job_id bigint;
begin
  select jobid into strict discovery_job_id
  from cron.job
  where jobname = 'chnscraping-discovery-dispatch';

  perform cron.alter_job(discovery_job_id, schedule := '3 16 * * *');
end;
$$;
