create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

revoke all on all tables in schema net from anon, authenticated;
revoke all on all sequences in schema net from anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'github_actions_dispatch_token'
  ) then
    raise exception
      'Create the github_actions_dispatch_token secret in Supabase Vault before applying this migration';
  end if;
end;
$$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'chnscraping-discovery-dispatch';

select cron.schedule(
  'chnscraping-discovery-dispatch',
  '7 16 * * *',
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
