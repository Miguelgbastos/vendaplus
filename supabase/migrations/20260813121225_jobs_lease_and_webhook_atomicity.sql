-- Recover expired processing leases; atomic raw_event+job enqueue; lead lock helper.

create or replace function public.claim_jobs(
  p_limit int default 10,
  p_worker_id text default 'worker',
  p_job_types text[] default array['process_kommo_event'],
  p_tenant_id uuid default null,
  p_lease_seconds int default 300
)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease interval;
begin
  if p_limit is null or p_limit < 1 then
    p_limit := 10;
  end if;
  if p_limit > 100 then
    p_limit := 100;
  end if;
  if p_lease_seconds is null or p_lease_seconds < 60 then
    p_lease_seconds := 300;
  end if;
  v_lease := make_interval(secs => p_lease_seconds);

  -- Requeue processing jobs whose lease expired.
  update public.jobs j
  set
    status = 'failed',
    last_error = coalesce(j.last_error, 'lease_expired'),
    locked_at = null,
    locked_by = null,
    available_at = now(),
    updated_at = now()
  where j.status = 'processing'
    and j.locked_at is not null
    and j.locked_at < now() - v_lease
    and (p_tenant_id is null or j.tenant_id = p_tenant_id)
    and (p_job_types is null or j.job_type = any (p_job_types));

  return query
  with candidates as (
    select j.id
    from public.jobs j
    where j.status in ('pending', 'failed')
      and j.available_at <= now()
      and j.attempts < j.max_attempts
      and (p_job_types is null or j.job_type = any (p_job_types))
      and (p_tenant_id is null or j.tenant_id = p_tenant_id)
    order by j.priority asc, j.created_at asc
    for update of j skip locked
    limit p_limit
  ),
  updated as (
    update public.jobs j
    set
      status = 'processing',
      attempts = j.attempts + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      updated_at = now()
    from candidates c
    where j.id = c.id
    returning j.*
  )
  select * from updated;
end;
$$;

revoke all on function public.claim_jobs(int, text, text[], uuid, int) from public;
revoke execute on function public.claim_jobs(int, text, text[], uuid, int) from anon, authenticated;
grant execute on function public.claim_jobs(int, text, text[], uuid, int) to service_role;

-- Keep legacy signature working for older callers via overload drop/replace:
-- Supabase clients call by named args; recreate without breaking if old 3-arg exists.
drop function if exists public.claim_jobs(int, text, text[]);

create or replace function public.replay_dead_jobs(
  p_tenant_id uuid,
  p_limit int default 20,
  p_job_types text[] default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_limit is null or p_limit < 1 then
    p_limit := 20;
  end if;
  if p_limit > 100 then
    p_limit := 100;
  end if;

  if not public.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.tenant_role[]) then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;

  with picked as (
    select j.id
    from public.jobs j
    where j.tenant_id = p_tenant_id
      and j.status = 'dead'
      and (p_job_types is null or j.job_type = any (p_job_types))
    order by j.updated_at asc
    for update skip locked
    limit p_limit
  )
  update public.jobs j
  set
    status = 'pending',
    attempts = 0,
    last_error = null,
    available_at = now(),
    locked_at = null,
    locked_by = null,
    completed_at = null,
    updated_at = now()
  from picked p
  where j.id = p.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.replay_dead_jobs(uuid, int, text[]) from public, anon;
grant execute on function public.replay_dead_jobs(uuid, int, text[]) to authenticated;

create or replace function public.enqueue_kommo_webhook_event(
  p_tenant_id uuid,
  p_webhook_endpoint_id uuid,
  p_event_type text,
  p_idempotency_key text,
  p_payload jsonb,
  p_headers jsonb,
  p_lead_ids text[]
)
returns table (raw_event_id uuid, job_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw_id uuid;
  v_job_id uuid;
  v_created boolean := false;
  v_existing_job uuid;
begin
  insert into public.raw_events (
    tenant_id,
    webhook_endpoint_id,
    provider,
    event_type,
    idempotency_key,
    payload,
    headers
  ) values (
    p_tenant_id,
    p_webhook_endpoint_id,
    'kommo',
    p_event_type,
    p_idempotency_key,
    p_payload,
    p_headers
  )
  on conflict (tenant_id, provider, idempotency_key) do nothing
  returning id into v_raw_id;

  if v_raw_id is null then
    select re.id into v_raw_id
    from public.raw_events re
    where re.tenant_id = p_tenant_id
      and re.provider = 'kommo'
      and re.idempotency_key = p_idempotency_key;
    v_created := false;
  else
    v_created := true;
  end if;

  if v_raw_id is null then
    raise exception 'raw_event_missing' using errcode = 'P0002';
  end if;

  if p_lead_ids is null or cardinality(p_lead_ids) = 0 then
    return query select v_raw_id, null::uuid, v_created;
    return;
  end if;

  select j.id into v_existing_job
  from public.jobs j
  where j.raw_event_id = v_raw_id
    and j.job_type = 'process_kommo_event'
  limit 1;

  if v_existing_job is not null then
    return query select v_raw_id, v_existing_job, false;
    return;
  end if;

  insert into public.jobs (
    tenant_id,
    raw_event_id,
    job_type,
    status,
    payload
  ) values (
    p_tenant_id,
    v_raw_id,
    'process_kommo_event',
    'pending',
    jsonb_build_object(
      'lead_ids', to_jsonb(p_lead_ids),
      'event_type', p_event_type
    )
  )
  on conflict do nothing
  returning id into v_job_id;

  if v_job_id is null then
    select j.id into v_job_id
    from public.jobs j
    where j.raw_event_id = v_raw_id
      and j.job_type = 'process_kommo_event'
    limit 1;
  end if;

  return query select v_raw_id, v_job_id, v_created;
end;
$$;

revoke all on function public.enqueue_kommo_webhook_event(uuid, uuid, text, text, jsonb, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.enqueue_kommo_webhook_event(uuid, uuid, text, text, jsonb, jsonb, text[])
  to service_role;

-- Advisory lock helper for lead serialization (called via RPC from workers).
create or replace function private.lock_tenant_lead(p_tenant_id uuid, p_kommo_lead_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(
    hashtext(p_tenant_id::text),
    hashtext(coalesce(p_kommo_lead_id, ''))
  );
end;
$$;

revoke all on function private.lock_tenant_lead(uuid, text) from public;
grant execute on function private.lock_tenant_lead(uuid, text) to service_role;

create or replace function public.lock_tenant_lead(p_tenant_id uuid, p_kommo_lead_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.lock_tenant_lead(p_tenant_id, p_kommo_lead_id);
end;
$$;

revoke all on function public.lock_tenant_lead(uuid, text) from public, anon, authenticated;
grant execute on function public.lock_tenant_lead(uuid, text) to service_role;
