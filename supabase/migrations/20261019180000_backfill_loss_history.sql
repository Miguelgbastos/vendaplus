-- Skip Meta CAPI outbox for kommo_backfill history inserts (avoid mass re-sends).
-- Enqueue one-shot backfill jobs for perda leads missing commercial from_qualification.

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
  -- Historical reconstruction must not enqueue Meta CAPI.
  if new.source = 'kommo_backfill' then
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

-- One authoritative backfill row per lead for perda reconstruction.
create unique index if not exists qualification_history_kommo_backfill_perda_unique
  on public.qualification_history (tenant_id, lead_id)
  where source = 'kommo_backfill' and to_qualification = 'perda';

-- Candidates: currently perda with closed_at, missing usable commercial from_qualification
-- for the last perda history (or no perda history at all).
create or replace function public.enqueue_backfill_loss_history(
  p_tenant_id uuid,
  p_limit int default 50
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_limit int;
begin
  if p_limit is null or p_limit < 1 then
    v_limit := 50;
  elsif p_limit > 200 then
    v_limit := 200;
  else
    v_limit := p_limit;
  end if;

  if not public.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.tenant_role[]) then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;

  with last_perda as (
    select distinct on (h.lead_id)
      h.lead_id,
      h.from_qualification,
      coalesce(h.metadata ->> 'inferred', '') as inferred
    from public.qualification_history h
    where h.tenant_id = p_tenant_id
      and h.to_qualification = 'perda'
    order by h.lead_id, h.changed_at desc, h.id desc
  ),
  candidates as (
    select
      l.id as lead_id,
      l.kommo_lead_id
    from public.leads l
    left join last_perda lp on lp.lead_id = l.id
    where l.tenant_id = p_tenant_id
      and l.qualification = 'perda'
      and l.kommo_lead_id is not null
      and l.kommo_lead_id ~ '^[0-9]+$'
      and l.kommo_lead_id <> '0'
      and l.closed_at is not null
      and (
        lp.lead_id is null
        or lp.inferred = 'true'
        or lp.from_qualification is null
        or lp.from_qualification not in ('sql', 'oportunidade', 'negociacao')
      )
      and not exists (
        select 1
        from public.qualification_history bh
        where bh.tenant_id = p_tenant_id
          and bh.lead_id = l.id
          and bh.source = 'kommo_backfill'
          and bh.to_qualification = 'perda'
          and bh.from_qualification in ('sql', 'oportunidade', 'negociacao')
      )
      and not exists (
        select 1
        from public.jobs j
        where j.tenant_id = p_tenant_id
          and j.job_type = 'backfill_kommo_loss_history'
          and j.status in ('pending', 'processing', 'failed')
          and j.payload ->> 'lead_id' = l.id::text
      )
    order by l.closed_at desc nulls last
    limit v_limit
  ),
  inserted as (
    insert into public.jobs (
      tenant_id, job_type, status, priority, payload, max_attempts, available_at
    )
    select
      p_tenant_id,
      'backfill_kommo_loss_history',
      'pending',
      150,
      jsonb_build_object(
        'lead_id', c.lead_id,
        'kommo_lead_id', c.kommo_lead_id
      ),
      5,
      -- Stagger starts to ease Kommo rate limits (~2 leads/sec burst).
      now() + ((row_number() over (order by c.lead_id) - 1) * interval '500 milliseconds')
    from candidates c
    returning 1
  )
  select count(*)::integer into v_count from inserted;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.enqueue_backfill_loss_history(uuid, int) from public, anon;
grant execute on function public.enqueue_backfill_loss_history(uuid, int) to authenticated, service_role;
