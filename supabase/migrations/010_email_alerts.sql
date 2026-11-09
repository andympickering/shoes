create table public.chnscraping_alert_subscriptions (
  id uuid primary key default gen_random_uuid(),
  unsubscribe_token uuid not null unique default gen_random_uuid(),
  search_terms text not null check (char_length(btrim(search_terms)) between 1 and 200),
  time_span text not null check (time_span in ('today', 'last_3_days', 'last_week')),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  delivery_time_utc time without time zone not null,
  schedule_day smallint not null check (schedule_day between 1 and 31),
  emails text[] not null check (cardinality(emails) between 1 and 10),
  active boolean not null default true,
  consent_confirmed_at timestamptz not null default now(),
  next_delivery_at timestamptz not null,
  lock_expires_at timestamptz,
  last_processed_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index chnscraping_alerts_due_idx
  on public.chnscraping_alert_subscriptions (next_delivery_at)
  where active;

alter table public.chnscraping_alert_subscriptions enable row level security;
revoke all on public.chnscraping_alert_subscriptions from public, anon, authenticated;
grant all on public.chnscraping_alert_subscriptions to service_role;

create table public.chnscraping_alert_creation_limits (
  request_hash text not null,
  window_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (request_hash, window_start)
);

alter table public.chnscraping_alert_creation_limits enable row level security;
revoke all on public.chnscraping_alert_creation_limits from public, anon, authenticated;
grant all on public.chnscraping_alert_creation_limits to service_role;

create or replace function public.chnscraping_create_alert_subscription(
  p_request_hash text,
  p_search_terms text,
  p_time_span text,
  p_frequency text,
  p_delivery_time_utc time without time zone,
  p_schedule_day smallint,
  p_emails text[],
  p_next_delivery_at timestamptz
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
  if p_request_hash is null or p_request_hash = '' then
    raise exception 'Request identity is required' using errcode = '22023';
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
    now(),
    p_next_delivery_at
  )
  returning id into subscription_id;

  return subscription_id;
end;
$$;

create or replace function public.chnscraping_claim_due_alerts(p_batch_size integer default 1)
returns table (
  subscription_id uuid,
  unsubscribe_token uuid,
  search_terms text,
  time_span text,
  frequency text,
  schedule_day smallint,
  emails text[],
  next_delivery_at timestamptz,
  lock_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 10 then
    raise exception 'Batch size must be between 1 and 10' using errcode = '22023';
  end if;

  return query
  with due as (
    select alert.id
    from public.chnscraping_alert_subscriptions as alert
    where alert.active
      and alert.next_delivery_at <= now()
      and (alert.lock_expires_at is null or alert.lock_expires_at <= now())
    order by alert.next_delivery_at
    for update skip locked
    limit p_batch_size
  )
  update public.chnscraping_alert_subscriptions as alert
  set lock_expires_at = now() + interval '15 minutes'
  from due
  where alert.id = due.id
  returning
    alert.id,
    alert.unsubscribe_token,
    alert.search_terms,
    alert.time_span,
    alert.frequency,
    alert.schedule_day,
    alert.emails,
    alert.next_delivery_at,
    alert.lock_expires_at;
end;
$$;

revoke all on function public.chnscraping_create_alert_subscription(text, text, text, text, time, smallint, text[], timestamptz) from public, anon, authenticated;
revoke all on function public.chnscraping_claim_due_alerts(integer) from public, anon, authenticated;
grant execute on function public.chnscraping_create_alert_subscription(text, text, text, text, time, smallint, text[], timestamptz) to service_role;
grant execute on function public.chnscraping_claim_due_alerts(integer) to service_role;
grant execute on function public.chnscraping_evaluate_article_search(jsonb, text, text, boolean) to service_role;
grant execute on function public.chnscraping_list_articles(jsonb, boolean, text, timestamptz, timestamptz, integer, integer) to service_role;
