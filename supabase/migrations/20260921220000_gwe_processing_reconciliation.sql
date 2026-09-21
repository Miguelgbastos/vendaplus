-- GWE v1 processing and snapshot reconciliation.
-- Keeps the legacy Kommo and Meta CAPI paths unchanged.

alter table public.processing_outbox
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text;

alter table public.event_processing
  add column if not exists outcome text;

create unique index if not exists stage_history_gwe_source_event_unique
  on public.stage_history (connection_id, lead_id, source_event_id)
  where connection_id is not null and source_event_id is not null;

create or replace function public.claim_processing_outbox(
  p_limit integer default 10,
  p_worker_id text default 'gwe-worker',
  p_lease_seconds integer default 300
)
returns setof public.processing_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  p_limit := least(greatest(coalesce(p_limit, 10), 1), 100);
  p_lease_seconds := greatest(coalesce(p_lease_seconds, 300), 60);

  update public.processing_outbox
  set status = 'failed',
      available_at = now(),
      locked_at = null,
      locked_by = null,
      last_error = coalesce(last_error, 'lease_expired'),
      updated_at = now()
  where status = 'processing'
    and locked_at < now() - make_interval(secs => p_lease_seconds);

  return query
  with candidates as (
    select po.id
    from public.processing_outbox po
    where po.status in ('pending', 'failed')
      and po.available_at <= now()
    order by po.available_at, po.created_at
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.processing_outbox po
    set status = 'processing',
        attempts = po.attempts + 1,
        locked_at = now(),
        locked_by = p_worker_id,
        updated_at = now()
    from candidates c
    where po.id = c.id
    returning po.*
  )
  select * from claimed;

  update public.event_processing ep
  set status = 'processing',
      started_at = coalesce(ep.started_at, now()),
      last_attempt_at = now(),
      attempts = ep.attempts + 1,
      updated_at = now()
  where ep.raw_event_id in (
    select po.raw_event_id
    from public.processing_outbox po
    where po.locked_by = p_worker_id
      and po.locked_at >= now() - make_interval(secs => p_lease_seconds)
      and po.status = 'processing'
  );
end;
$$;

revoke all on function public.claim_processing_outbox(integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_processing_outbox(integer, text, integer)
  to service_role;

create or replace function public.reconcile_crm_lead_snapshot(
  p_raw_event_id uuid,
  p_snapshot jsonb
)
returns table (outcome text, lead_id uuid, new_milestones integer, stage_changed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw public.raw_events%rowtype;
  v_lead public.leads%rowtype;
  v_snapshot_lead jsonb := p_snapshot->'identity';
  v_crm jsonb := p_snapshot->'crm';
  v_pipeline jsonb := v_crm->'pipeline';
  v_stage jsonb := v_crm->'stage';
  v_lifecycle jsonb := p_snapshot->'lifecycle';
  v_source jsonb := p_snapshot->'sourceEvent';
  v_external_id text := p_snapshot->>'externalLeadId';
  v_connection_id uuid := (p_snapshot->>'connectionId')::uuid;
  v_tenant_id uuid := (p_snapshot->>'tenantId')::uuid;
  v_occurred_at timestamptz := (v_source->>'occurredAt')::timestamptz;
  v_sequence bigint := nullif(v_source->>'sequence', '')::bigint;
  v_current_stage public.qualification_stage :=
    nullif(v_lifecycle->>'currentStage', '')::public.qualification_stage;
  v_stage_changed boolean := false;
  v_new_milestones integer := 0;
  v_stage_name text;
  v_stage_id text;
  v_pipeline_id text;
  v_name text;
  v_previous_pipeline_id text;
  v_previous_stage_id text;
  v_previous_stage_name text;
  v_previous_qualification public.qualification_stage;
  v_was_new boolean := false;
  v_existing_milestone boolean;
begin
  select re.* into v_raw
  from public.raw_events re
  where re.id = p_raw_event_id
  for update;

  if not found
     or v_raw.connection_id is distinct from v_connection_id
     or v_raw.tenant_id is distinct from v_tenant_id
     or v_raw.external_event_id is distinct from p_snapshot->'sourceEvent'->>'id'
  then
    raise exception 'gwe_snapshot_event_mismatch' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(v_connection_id::text),
    hashtext(v_external_id)
  );

  select l.* into v_lead
  from public.leads l
  where l.connection_id = v_connection_id
    and l.external_lead_id = v_external_id
  for update;

  if v_lead.id is not null and (
    (v_sequence is not null and v_lead.last_source_sequence is not null
      and v_sequence <= v_lead.last_source_sequence)
    or
    (v_sequence is null and v_lead.last_source_sequence is null
      and v_lead.last_source_event_at is not null
      and v_occurred_at <= v_lead.last_source_event_at)
  ) then
    update public.event_processing
    set status = 'processed', outcome = 'stale_ignored', processed_at = now(),
        updated_at = now()
    where raw_event_id = p_raw_event_id;
    update public.processing_outbox
    set status = 'published', published_at = now(), locked_at = null,
        locked_by = null, updated_at = now()
    where raw_event_id = p_raw_event_id and status = 'processing';
    update public.raw_events set processed_at = now() where id = p_raw_event_id;
    return query select 'stale_ignored'::text, v_lead.id, 0, false;
    return;
  end if;

  v_pipeline_id := v_pipeline->>'id';
  v_stage_id := v_stage->>'id';
  v_stage_name := v_stage->>'name';
  v_stage_changed := v_lead.id is not null and (
    v_lead.pipeline_id is distinct from v_pipeline_id
    or v_lead.status_id is distinct from v_stage_id
    or v_lead.status_name is distinct from v_stage_name
  );
  v_previous_pipeline_id := v_lead.pipeline_id;
  v_previous_stage_id := v_lead.status_id;
  v_previous_stage_name := v_lead.status_name;
  v_previous_qualification := v_lead.qualification;

  if v_lead.id is null then
    v_was_new := true;
    insert into public.leads (
      tenant_id, connection_id, external_lead_id, name, pipeline_id,
      status_id, status_name, price, responsible_user_id, qualification,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      custom_fields, raw, first_seen_at, last_seen_at,
      last_source_event_at, last_source_sequence, last_source_event_id,
      updated_at
    ) values (
      v_tenant_id, v_connection_id, v_external_id, v_snapshot_lead->>'name',
      v_pipeline_id, v_stage_id, v_stage_name,
      nullif(p_snapshot->'commercial'->>'amount', '')::numeric,
      p_snapshot->'crm'->>'ownerId', v_current_stage,
      p_snapshot->'attribution'->>'utmSource',
      p_snapshot->'attribution'->>'utmMedium',
      p_snapshot->'attribution'->>'utmCampaign',
      p_snapshot->'attribution'->>'utmContent',
      p_snapshot->'attribution'->>'utmTerm',
      coalesce(p_snapshot->'custom', '{}'::jsonb), p_snapshot,
      coalesce(nullif(p_snapshot->>'createdAt', '')::timestamptz, now()),
      now(), v_occurred_at, v_sequence, v_source->>'id', now()
    )
    returning * into v_lead;
  else
    update public.leads
    set name = v_snapshot_lead->>'name',
        pipeline_id = v_pipeline_id,
        status_id = v_stage_id,
        status_name = v_stage_name,
        price = nullif(p_snapshot->'commercial'->>'amount', '')::numeric,
        responsible_user_id = p_snapshot->'crm'->>'ownerId',
        qualification = v_current_stage,
        utm_source = p_snapshot->'attribution'->>'utmSource',
        utm_medium = p_snapshot->'attribution'->>'utmMedium',
        utm_campaign = p_snapshot->'attribution'->>'utmCampaign',
        utm_content = p_snapshot->'attribution'->>'utmContent',
        utm_term = p_snapshot->'attribution'->>'utmTerm',
        custom_fields = coalesce(p_snapshot->'custom', '{}'::jsonb),
        raw = p_snapshot, last_seen_at = now(),
        last_source_event_at = v_occurred_at,
        last_source_sequence = v_sequence,
        last_source_event_id = v_source->>'id',
        updated_at = now()
    where id = v_lead.id
    returning * into v_lead;
  end if;

  if v_stage_changed then
    insert into public.stage_history (
      tenant_id, lead_id, connection_id, source_event_id,
      from_pipeline_id, from_status_id, from_status_name,
      to_pipeline_id, to_status_id, to_status_name, source, metadata
    ) values (
      v_tenant_id, v_lead.id, v_connection_id, v_source->>'id',
      v_previous_pipeline_id, v_previous_stage_id, v_previous_stage_name,
      v_pipeline_id, v_stage_id, v_stage_name, 'gwe',
      jsonb_build_object('source_event_id', v_source->>'id')
    )
    on conflict do nothing;
  end if;

  for v_name in
    select key from jsonb_each(v_lifecycle->'milestones')
    where value->>'reached' = 'true'
  loop
    select exists (
      select 1 from public.qualification_history qh
      where qh.connection_id = v_connection_id
        and qh.lead_id = v_lead.id
        and qh.to_qualification = v_name::public.qualification_stage
    ) into v_existing_milestone;
    if not v_existing_milestone then
      insert into public.qualification_history (
        tenant_id, lead_id, connection_id, source_event_id,
        from_qualification, to_qualification, source, metadata
      ) values (
        v_tenant_id, v_lead.id, v_connection_id, v_source->>'id',
        v_previous_qualification, v_name::public.qualification_stage, 'gwe',
        jsonb_build_object(
          'history_complete', (v_lifecycle->>'historyComplete')::boolean,
          'source_reached_at', null,
          'historically_known', true
        )
      )
      on conflict do nothing;
      if found then v_new_milestones := v_new_milestones + 1; end if;
    end if;
  end loop;

  update public.event_processing
  set status = 'processed',
      outcome = case when v_new_milestones > 0 or v_stage_changed or v_was_new
                    then 'applied' else 'noop' end,
      last_error_code = case
        when (v_lifecycle->>'historyComplete')::boolean
          and exists (
            select 1
            from public.qualification_history qh
            where qh.connection_id = v_connection_id
              and qh.lead_id = v_lead.id
              and not exists (
                select 1
                from jsonb_each(v_lifecycle->'milestones') incoming
                where incoming.key = qh.to_qualification::text
                  and incoming.value->>'reached' = 'true'
              )
          )
        then 'milestone_regression_preserved'
        else null
      end,
      processed_at = now(), updated_at = now()
  where raw_event_id = p_raw_event_id;
  update public.processing_outbox
  set status = 'published', published_at = now(), locked_at = null,
      locked_by = null, updated_at = now()
  where raw_event_id = p_raw_event_id and status = 'processing';
  update public.raw_events set processed_at = now() where id = p_raw_event_id;

  return query select
    case when v_new_milestones > 0 or v_stage_changed then 'applied' else 'noop' end,
    v_lead.id, v_new_milestones, v_stage_changed;
end;
$$;

revoke all on function public.reconcile_crm_lead_snapshot(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.reconcile_crm_lead_snapshot(uuid, jsonb)
  to service_role;

create or replace function public.fail_processing_outbox(
  p_raw_event_id uuid,
  p_error_code text,
  p_error_message text,
  p_retry_seconds integer default 60
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  select attempts into v_attempts
  from public.processing_outbox
  where raw_event_id = p_raw_event_id and status = 'processing'
  for update;
  if not found then return; end if;

  if v_attempts >= 5 then
    update public.processing_outbox
    set status = 'failed', last_error = p_error_message,
        locked_at = null, locked_by = null, updated_at = now()
    where raw_event_id = p_raw_event_id;
    update public.event_processing
    set status = 'dead_letter', last_error_code = p_error_code,
        last_error_message = p_error_message, updated_at = now()
    where raw_event_id = p_raw_event_id;
  else
    update public.processing_outbox
    set status = 'failed', available_at = now() + make_interval(secs => p_retry_seconds),
        last_error = p_error_message, locked_at = null, locked_by = null,
        updated_at = now()
    where raw_event_id = p_raw_event_id;
    update public.event_processing
    set status = 'retry_pending', last_error_code = p_error_code,
        last_error_message = p_error_message,
        next_retry_at = now() + make_interval(secs => p_retry_seconds),
        updated_at = now()
    where raw_event_id = p_raw_event_id;
  end if;
end;
$$;

revoke all on function public.fail_processing_outbox(uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.fail_processing_outbox(uuid, text, text, integer)
  to service_role;
