-- Skip re-enqueue after any kommo_backfill attempt (resolved or unresolved marker).
-- Backfill markers for already-completed jobs that never wrote a history row.

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
      -- Any prior backfill attempt (commercial or unresolved marker) skips re-queue.
      and not exists (
        select 1
        from public.qualification_history bh
        where bh.tenant_id = p_tenant_id
          and bh.lead_id = l.id
          and bh.source = 'kommo_backfill'
          and bh.to_qualification = 'perda'
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
      now() + ((row_number() over (order by c.lead_id) - 1) * interval '2 seconds')
    from candidates c
    returning 1
  )
  select count(*)::integer into v_count from inserted;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.enqueue_backfill_loss_history(uuid, int) from public, anon;
grant execute on function public.enqueue_backfill_loss_history(uuid, int) to authenticated, service_role;

-- One-shot: mark leads whose backfill job completed without writing history
-- (previous unresolved path), so the next button click does not re-hit Kommo.
insert into public.qualification_history (
  tenant_id,
  lead_id,
  from_qualification,
  to_qualification,
  source,
  changed_at,
  metadata
)
select
  s.tenant_id,
  s.lead_id,
  null,
  'perda',
  'kommo_backfill',
  coalesce(
    (
      select h.changed_at - interval '1 second'
      from public.qualification_history h
      where h.tenant_id = s.tenant_id
        and h.lead_id = s.lead_id
        and h.to_qualification = 'perda'
      order by h.changed_at desc, h.id desc
      limit 1
    ),
    s.closed_at,
    s.completed_at,
    now()
  ),
  jsonb_build_object(
    'backfill', true,
    'resolution', 'unresolved',
    'kommo_lead_id', s.kommo_lead_id,
    'retroactive_marker', true
  )
from (
  select distinct on ((j.payload ->> 'lead_id')::uuid)
    j.tenant_id,
    (j.payload ->> 'lead_id')::uuid as lead_id,
    j.payload ->> 'kommo_lead_id' as kommo_lead_id,
    j.completed_at,
    l.closed_at
  from public.jobs j
  join public.leads l
    on l.id = (j.payload ->> 'lead_id')::uuid
   and l.tenant_id = j.tenant_id
  where j.job_type = 'backfill_kommo_loss_history'
    and j.status = 'completed'
    and j.payload ->> 'lead_id' ~ '^[0-9a-f-]{36}$'
    and not exists (
      select 1
      from public.qualification_history bh
      where bh.tenant_id = j.tenant_id
        and bh.lead_id = (j.payload ->> 'lead_id')::uuid
        and bh.source = 'kommo_backfill'
        and bh.to_qualification = 'perda'
    )
  order by (j.payload ->> 'lead_id')::uuid, j.completed_at desc nulls last
) s;
