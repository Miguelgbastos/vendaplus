-- Batch A — correção do pipeline de eventos:
--  1) Não enfileirar Meta CAPI para reconstruções históricas (kommo_backfill OU
--     milestones GWE marcados como historically_known) — evita envio em massa.
--  2) Carimbar changed_at real nas inserções de qualification_history feitas pelo
--     webhook Kommo (sync_kommo_lead_state) e pelo GWE (reconcile_crm_lead_snapshot),
--     em vez de depender do default now() — mantém funil, dwell e event_time corretos.

-- ---------------------------------------------------------------------------
-- 1) Trigger de outbox CAPI: ampliar o guard de reconstrução histórica.
-- ---------------------------------------------------------------------------
create or replace function private.enqueue_meta_capi_from_qualification_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_mapping public.meta_capi_event_mappings%rowtype;
begin
  -- Reconstrução histórica nunca deve enfileirar Meta CAPI:
  --  - kommo_backfill: backfill de perdas sem estágio anterior;
  --  - historically_known: milestones reconstruídos pelo GWE num snapshot;
  --  - suppress_meta_capi: escape hatch explícito para futuros produtores.
  if new.source = 'kommo_backfill'
     or coalesce(new.metadata ->> 'historically_known', '') = 'true'
     or coalesce(new.metadata ->> 'suppress_meta_capi', '') = 'true'
  then
    return new;
  end if;

  select * into v_lead
  from public.leads
  where id = new.lead_id;

  select m.* into v_mapping
  from public.meta_capi_event_mappings m
  join public.meta_capi_connections c
    on c.tenant_id = m.tenant_id
   and c.is_enabled = true
   and c.pixel_id is not null
   and c.access_token_encrypted is not null
  where m.tenant_id = new.tenant_id
    and m.qualification = new.to_qualification
    and m.is_active = true;

  if v_mapping.id is not null then
    insert into public.jobs (
      tenant_id, job_type, status, priority, payload, max_attempts
    ) values (
      new.tenant_id, 'send_meta_capi_event', 'pending', 200,
      jsonb_build_object(
        'lead_id', new.lead_id,
        'qualification', new.to_qualification,
        'occurred_at', new.changed_at,
        'event_time_source', 'qualification_history.changed_at',
        'event_id', 'qh-' || new.id::text,
        'qualification_history_id', new.id,
        'meta_event_name', v_mapping.event_name,
        'value', v_lead.price,
        'currency', v_mapping.currency,
        'attribution', jsonb_build_object(
          'utm_source', v_lead.utm_source,
          'utm_medium', v_lead.utm_medium,
          'utm_campaign', v_lead.utm_campaign,
          'utm_content', v_lead.utm_content,
          'utm_term', v_lead.utm_term
        )
      ),
      5
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2a) Webhook Kommo: aceitar p_changed_at e usá-lo no histórico de qualificação.
--     Assinatura ganha um parâmetro opcional ao final (backward-compatible).
-- ---------------------------------------------------------------------------
create or replace function public.sync_kommo_lead_state(
  p_tenant_id uuid,
  p_kommo_lead_id text,
  p_lead jsonb,
  p_contact jsonb default null,
  p_transitions public.qualification_stage[] default '{}'::public.qualification_stage[],
  p_from_qualification public.qualification_stage default null,
  p_stage_changed boolean default false,
  p_previous_pipeline_id text default null,
  p_previous_status_id text default null,
  p_previous_status_name text default null,
  p_changed_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact_id uuid;
  v_lead_id uuid;
  v_previous public.leads%rowtype;
  v_from public.qualification_stage;
  v_to public.qualification_stage;
  v_transition public.qualification_stage;
  v_changed_at timestamptz := coalesce(p_changed_at, now());
begin
  if p_kommo_lead_id is null or p_kommo_lead_id !~ '^[0-9]+$' then
    raise exception 'invalid_kommo_lead_id' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_tenant_id::text),
    hashtext(p_kommo_lead_id)
  );

  select * into v_previous
  from public.leads
  where tenant_id = p_tenant_id
    and kommo_lead_id = p_kommo_lead_id
  for update;

  if p_contact is not null and (p_contact ? 'kommo_contact_id') then
    insert into public.contacts (
      tenant_id, kommo_contact_id, name, email, phone, company, raw, last_seen_at, updated_at
    ) values (
      p_tenant_id,
      nullif(p_contact->>'kommo_contact_id', ''),
      p_contact->>'name',
      p_contact->>'email',
      p_contact->>'phone',
      p_contact->>'company',
      p_contact,
      now(),
      now()
    )
    on conflict (tenant_id, kommo_contact_id) do update
      set
        name = excluded.name,
        email = excluded.email,
        phone = excluded.phone,
        company = excluded.company,
        raw = excluded.raw,
        last_seen_at = now(),
        updated_at = now()
    returning id into v_contact_id;
  end if;

  insert into public.leads (
    tenant_id,
    contact_id,
    kommo_lead_id,
    name,
    pipeline_id,
    status_id,
    status_name,
    price,
    responsible_user_id,
    qualification,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    custom_fields,
    raw,
    first_seen_at,
    last_seen_at,
    closed_at,
    updated_at
  ) values (
    p_tenant_id,
    coalesce(v_contact_id, null),
    p_kommo_lead_id,
    p_lead->>'name',
    p_lead->>'pipeline_id',
    p_lead->>'status_id',
    p_lead->>'status_name',
    nullif(p_lead->>'price', '')::numeric,
    p_lead->>'responsible_user_id',
    nullif(p_lead->>'qualification', '')::public.qualification_stage,
    p_lead->>'utm_source',
    p_lead->>'utm_medium',
    p_lead->>'utm_campaign',
    p_lead->>'utm_content',
    p_lead->>'utm_term',
    coalesce(p_lead->'custom_fields', '{}'::jsonb),
    coalesce(p_lead->'raw', '{}'::jsonb),
    coalesce(nullif(p_lead->>'first_seen_at', '')::timestamptz, now()),
    now(),
    nullif(p_lead->>'closed_at', '')::timestamptz,
    now()
  )
  on conflict (tenant_id, kommo_lead_id) do update
    set
      contact_id = coalesce(excluded.contact_id, public.leads.contact_id),
      name = excluded.name,
      pipeline_id = excluded.pipeline_id,
      status_id = excluded.status_id,
      status_name = excluded.status_name,
      price = excluded.price,
      responsible_user_id = excluded.responsible_user_id,
      qualification = excluded.qualification,
      utm_source = excluded.utm_source,
      utm_medium = excluded.utm_medium,
      utm_campaign = excluded.utm_campaign,
      utm_content = excluded.utm_content,
      utm_term = excluded.utm_term,
      custom_fields = excluded.custom_fields,
      raw = excluded.raw,
      first_seen_at = coalesce(
        public.leads.first_seen_at,
        nullif(excluded.first_seen_at, 'epoch'::timestamptz),
        excluded.first_seen_at
      ),
      last_seen_at = now(),
      closed_at = excluded.closed_at,
      updated_at = now()
  returning id into v_lead_id;

  -- History only when qualification actually changed vs locked previous row.
  if p_transitions is not null
     and cardinality(p_transitions) > 0
     and (
       v_previous.id is null
       or v_previous.qualification is distinct from (nullif(p_lead->>'qualification', '')::public.qualification_stage)
     )
  then
    v_from := case
      when v_previous.id is null then null
      else v_previous.qualification
    end;
    foreach v_transition in array p_transitions
    loop
      v_to := v_transition;
      insert into public.qualification_history (
        tenant_id, lead_id, from_qualification, to_qualification, source, changed_at, metadata
      ) values (
        p_tenant_id,
        v_lead_id,
        v_from,
        v_to,
        'kommo',
        v_changed_at,
        jsonb_build_object(
          'inferred', v_to is distinct from (nullif(p_lead->>'qualification', '')::public.qualification_stage),
          'initial', v_previous.id is null
        )
      );
      v_from := v_to;
    end loop;
  end if;

  -- Decide from the row locked in this transaction. Values calculated by the
  -- worker before the RPC can be stale when two deliveries overlap.
  if v_previous.id is not null
     and (
       v_previous.pipeline_id is distinct from (p_lead->>'pipeline_id')
       or v_previous.status_id is distinct from (p_lead->>'status_id')
     )
  then
    insert into public.stage_history (
      tenant_id, lead_id, from_pipeline_id, from_status_id, from_status_name,
      to_pipeline_id, to_status_id, to_status_name, source
    ) values (
      p_tenant_id,
      v_lead_id,
      v_previous.pipeline_id,
      v_previous.status_id,
      v_previous.status_name,
      p_lead->>'pipeline_id',
      p_lead->>'status_id',
      p_lead->>'status_name',
      'kommo'
    );
  end if;

  return v_lead_id;
end;
$$;

revoke all on function public.sync_kommo_lead_state(
  uuid, text, jsonb, jsonb, public.qualification_stage[], public.qualification_stage, boolean, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.sync_kommo_lead_state(
  uuid, text, jsonb, jsonb, public.qualification_stage[], public.qualification_stage, boolean, text, text, text, timestamptz
) to service_role;

-- Remover a assinatura antiga (sem p_changed_at) para evitar overload ambíguo.
drop function if exists public.sync_kommo_lead_state(
  uuid, text, jsonb, jsonb, public.qualification_stage[], public.qualification_stage, boolean, text, text, text
);

-- ---------------------------------------------------------------------------
-- 2b) GWE: carimbar changed_at = occurredAt do evento nos milestones.
-- ---------------------------------------------------------------------------
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
        from_qualification, to_qualification, source, changed_at, metadata
      ) values (
        v_tenant_id, v_lead.id, v_connection_id, v_source->>'id',
        v_previous_qualification, v_name::public.qualification_stage, 'gwe',
        coalesce(v_occurred_at, now()),
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
