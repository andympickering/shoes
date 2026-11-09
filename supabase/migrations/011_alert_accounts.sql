alter table public.chnscraping_alert_subscriptions
  add column owner_user_id uuid references auth.users(id) on delete cascade;

update public.chnscraping_alert_subscriptions
set active = false
where owner_user_id is null;

create index chnscraping_alerts_owner_idx
  on public.chnscraping_alert_subscriptions (owner_user_id, created_at desc);

drop function public.chnscraping_create_alert_subscription(
  text, text, text, text, time, smallint, text[], timestamptz
);

create or replace function public.chnscraping_create_alert_subscription(
  p_request_hash text,
  p_search_terms text,
  p_time_span text,
  p_frequency text,
  p_delivery_time_utc time without time zone,
  p_schedule_day smallint,
  p_emails text[],
  p_next_delivery_at timestamptz,
  p_owner_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_count integer;
  subscription_id uuid;
begin
  if p_request_hash is null or p_request_hash = '' or p_owner_user_id is null then
    raise exception 'Request identity and account are required' using errcode = '22023';
  end if;

  delete from public.chnscraping_alert_creation_limits
  where window_start < date_trunc('hour', now()) - interval '24 hours';

  insert into public.chnscraping_alert_creation_limits (request_hash, window_start, request_count)
  values (p_request_hash, date_trunc('hour', now()), 1)
  on conflict (request_hash, window_start)
  do update set request_count = chnscraping_alert_creation_limits.request_count + 1
  returning request_count into current_count;

  if current_count > 5 then
    raise exception 'Alert creation rate limit exceeded.' using errcode = 'P0001';
  end if;

  insert into public.chnscraping_alert_subscriptions (
    search_terms,
    time_span,
    frequency,
    delivery_time_utc,
    schedule_day,
    emails,
    owner_user_id,
    consent_confirmed_at,
    next_delivery_at
  )
  values (
    p_search_terms,
    p_time_span,
    p_frequency,
    p_delivery_time_utc,
    p_schedule_day,
    p_emails,
    p_owner_user_id,
    now(),
    p_next_delivery_at
  )
  returning id into subscription_id;

  return subscription_id;
end;
$$;

revoke all on function public.chnscraping_create_alert_subscription(
  text, text, text, text, time, smallint, text[], timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.chnscraping_create_alert_subscription(
  text, text, text, text, time, smallint, text[], timestamptz, uuid
) to service_role;
