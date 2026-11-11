create table public.chnscraping_alert_recipients (
  subscription_id uuid not null references public.chnscraping_alert_subscriptions(id) on delete cascade,
  email text not null,
  confirmation_token uuid not null unique default gen_random_uuid(),
  confirmed_at timestamptz,
  primary key (subscription_id, email)
);

create unique index chnscraping_alert_recipient_email_idx
  on public.chnscraping_alert_recipients (subscription_id, lower(email));

alter table public.chnscraping_alert_recipients enable row level security;
revoke all on public.chnscraping_alert_recipients from public, anon, authenticated;
grant all on public.chnscraping_alert_recipients to service_role;

insert into public.chnscraping_alert_recipients (subscription_id, email, confirmed_at)
select alert.id, address.email, now()
from public.chnscraping_alert_subscriptions as alert
cross join lateral unnest(alert.emails) as address(email)
on conflict do nothing;

create function public.chnscraping_sync_alert_recipients()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  delete from public.chnscraping_alert_recipients as recipient
  where recipient.subscription_id = new.id
    and not exists (
      select 1 from unnest(new.emails) as address(email)
      where lower(address.email) = lower(recipient.email)
    );

  insert into public.chnscraping_alert_recipients (subscription_id, email)
  select new.id, address.email
  from unnest(new.emails) as address(email)
  on conflict do nothing;
  return new;
end;
$$;

create trigger chnscraping_sync_alert_recipients
after insert or update of emails on public.chnscraping_alert_subscriptions
for each row execute function public.chnscraping_sync_alert_recipients();

create table public.chnscraping_alert_confirmation_limits (
  limit_key text not null,
  window_start timestamptz not null,
  request_count integer not null,
  primary key (limit_key, window_start)
);

alter table public.chnscraping_alert_confirmation_limits enable row level security;
revoke all on public.chnscraping_alert_confirmation_limits from public, anon, authenticated;
grant all on public.chnscraping_alert_confirmation_limits to service_role;

create function public.chnscraping_claim_alert_confirmation(
  p_subscription_id uuid,
  p_owner_user_id uuid,
  p_email text
)
returns table (email text, confirmation_token uuid, search_terms text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recipient_email text;
  recipient_token uuid;
  terms text;
  current_count integer;
begin
  select r.email, r.confirmation_token, a.search_terms
  into recipient_email, recipient_token, terms
  from public.chnscraping_alert_recipients as r
  join public.chnscraping_alert_subscriptions as a on a.id = r.subscription_id
  where r.subscription_id = p_subscription_id
    and a.owner_user_id = p_owner_user_id
    and lower(r.email) = lower(p_email)
    and r.confirmed_at is null
  for update of r;

  if not found then return; end if;

  delete from public.chnscraping_alert_confirmation_limits
  where window_start < date_trunc('hour', now()) - interval '24 hours';

  insert into public.chnscraping_alert_confirmation_limits as limits (limit_key, window_start, request_count)
  values ('owner:' || p_owner_user_id::text, date_trunc('hour', now()), 1)
  on conflict (limit_key, window_start)
  do update set request_count = limits.request_count + 1
  returning request_count into current_count;

  if current_count > 50 then return; end if;

  insert into public.chnscraping_alert_confirmation_limits as limits (limit_key, window_start, request_count)
  values ('email:' || lower(recipient_email), date_trunc('hour', now()), 1)
  on conflict (limit_key, window_start)
  do update set request_count = limits.request_count + 1
  returning request_count into current_count;

  if current_count > 5 then return; end if;
  return query select recipient_email, recipient_token, terms;
end;
$$;

revoke all on function public.chnscraping_claim_alert_confirmation(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.chnscraping_claim_alert_confirmation(uuid, uuid, text)
  to service_role;
