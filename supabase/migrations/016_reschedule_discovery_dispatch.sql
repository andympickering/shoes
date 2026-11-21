select cron.unschedule(jobid)
from cron.job
where jobname = 'chnscraping-discovery-dispatch';

select cron.schedule(
  'chnscraping-discovery-dispatch',
  '47 12 * * *',
  $$
    select net.http_post(
      url := 'https://api.github.com/repos/andympickering/chnscraping/actions/workflows/discovery-scheduler.yml/dispatches',
      headers := jsonb_build_object(
        'Accept', 'application/vnd.github+json',
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'github_actions_dispatch_token'
        ),
        'X-GitHub-Api-Version', '2022-11-28'
      ),
      body := '{"ref":"master"}'::jsonb,
      timeout_milliseconds := 10000
    );
  $$
);
