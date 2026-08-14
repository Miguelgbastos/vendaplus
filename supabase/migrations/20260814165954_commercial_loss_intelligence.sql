-- Commercial loss intelligence: previous-stage losses, stagnant open leads,
-- stage×reason matrix, owner conversion, close-cycle medians + recovered losses.
-- Incremental only — does not rewrite published migrations.

-- ---------------------------------------------------------------------------
-- dashboard_dimension_performance: add owner dimension (responsible_user_id)
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_dimension_performance(
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_dimension text,
  p_fallback text,
  p_campaign text default null,
  p_source text default null,
  p_medium text default null,
  p_owner text default null,
  p_stage public.qualification_stage default null
)
returns table (
  name text,
  leads bigint,
  mql bigint,
  sal bigint,
  sql bigint,
  oportunidade bigint,
  negociacao bigint,
  venda bigint,
  perda bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    case
      when btrim(coalesce(d.value, '')) = '' then p_fallback
      when p_dimension = 'owner' then btrim(d.value)
      else replace(btrim(d.value), '_', ' ')
    end as name,
    count(*) as leads,
    count(*) filter (where 'mql' = any (r.reached)) as mql,
    count(*) filter (where 'sal' = any (r.reached)) as sal,
    count(*) filter (where 'sql' = any (r.reached)) as sql,
    count(*) filter (where 'oportunidade' = any (r.reached)) as oportunidade,
    count(*) filter (where 'negociacao' = any (r.reached)) as negociacao,
    count(*) filter (where 'venda' = any (r.reached)) as venda,
    count(*) filter (where 'perda' = any (r.reached)) as perda
  from public.leads l
  cross join lateral (
    select case p_dimension
      when 'campaign' then l.utm_campaign
      when 'source' then l.utm_source
      when 'medium' then l.utm_medium
      when 'content' then l.utm_content
      when 'owner' then l.responsible_user_id
    end as value
  ) d
  cross join lateral (
    select public.dashboard_reached_stages(l.qualification, l.custom_fields) as reached
    offset 0
  ) r
  where l.tenant_id = p_tenant_id
    and l.first_seen_at >= p_from
    and l.first_seen_at < p_to
    and public.dashboard_dim_match(l.utm_campaign, p_campaign)
    and public.dashboard_dim_match(l.utm_source, p_source)
    and public.dashboard_dim_match(l.utm_medium, p_medium)
    and public.dashboard_dim_match(l.responsible_user_id, p_owner)
    and (p_stage is null or p_stage = any (r.reached))
  group by 1
  order by leads desc, name asc
$$;

-- ---------------------------------------------------------------------------
-- dashboard_loss_events_deduped: shared loss population for bars + matrix
-- Authoritative: last qualification_history.to_qualification='perda' with
-- changed_at in [p_from, p_to). Includes leads later reopened/sold.
-- Fallback: currently perda + closed_at in period + no perda history event
-- in the period → from_qualification null (sem_historico). Lead filters
-- apply after event selection (tenant + dims), without requiring current=perda.
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_loss_events_deduped(
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_campaign text default null,
  p_source text default null,
  p_medium text default null,
  p_owner text default null,
  p_stage public.qualification_stage default null
)
returns table (
  lead_id uuid,
  from_qualification public.qualification_stage,
  has_history boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with history_losses as (
    select distinct on (h.lead_id)
      h.lead_id,
      h.from_qualification
    from public.qualification_history h
    where h.tenant_id = p_tenant_id
      and h.to_qualification = 'perda'
      and h.changed_at >= p_from
      and h.changed_at < p_to
      and coalesce(h.metadata ->> 'inferred', '') <> 'true'
    order by h.lead_id, h.changed_at desc, h.id desc
  ),
  history_scoped as (
    select
      hl.lead_id,
      hl.from_qualification,
      true as has_history
    from history_losses hl
    join public.leads l
      on l.id = hl.lead_id
     and l.tenant_id = p_tenant_id
    where public.dashboard_dim_match(l.utm_campaign, p_campaign)
      and public.dashboard_dim_match(l.utm_source, p_source)
      and public.dashboard_dim_match(l.utm_medium, p_medium)
      and public.dashboard_dim_match(l.responsible_user_id, p_owner)
      and (
        p_stage is null
        or p_stage = any (public.dashboard_reached_stages(l.qualification, l.custom_fields))
      )
  ),
  closed_fallback as (
    select
      l.id as lead_id,
      null::public.qualification_stage as from_qualification,
      false as has_history
    from public.leads l
    where l.tenant_id = p_tenant_id
      and l.qualification = 'perda'
      and l.closed_at >= p_from
      and l.closed_at < p_to
      and public.dashboard_dim_match(l.utm_campaign, p_campaign)
      and public.dashboard_dim_match(l.utm_source, p_source)
      and public.dashboard_dim_match(l.utm_medium, p_medium)
      and public.dashboard_dim_match(l.responsible_user_id, p_owner)
      and (
        p_stage is null
        or p_stage = any (public.dashboard_reached_stages(l.qualification, l.custom_fields))
      )
      and not exists (
        select 1
        from public.qualification_history h
        where h.tenant_id = p_tenant_id
          and h.lead_id = l.id
          and h.to_qualification = 'perda'
          and h.changed_at >= p_from
          and h.changed_at < p_to
          and coalesce(h.metadata ->> 'inferred', '') <> 'true'
      )
  )
  select hs.lead_id, hs.from_qualification, hs.has_history from history_scoped hs
  union all
  select cf.lead_id, cf.from_qualification, cf.has_history from closed_fallback cf
$$;

-- ---------------------------------------------------------------------------
-- dashboard_loss_previous_stage: bars from shared deduped population
-- Categories: sql | oportunidade | negociacao | sem_historico
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_loss_previous_stage(
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_campaign text default null,
  p_source text default null,
  p_medium text default null,
  p_owner text default null,
  p_stage public.qualification_stage default null
)
returns table (
  previous_stage text,
  total bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with population as (
    select *
    from public.dashboard_loss_events_deduped(
      p_tenant_id, p_from, p_to, p_campaign, p_source, p_medium, p_owner, p_stage
    )
  ),
  classified as (
    select
      case
        when p.has_history
          and p.from_qualification in (
            'sql'::public.qualification_stage,
            'oportunidade'::public.qualification_stage,
            'negociacao'::public.qualification_stage
          )
          then p.from_qualification::text
        else 'sem_historico'
      end as previous_stage
    from population p
  ),
  buckets as (
    select unnest(array['sql', 'oportunidade', 'negociacao', 'sem_historico']) as previous_stage
  )
  select b.previous_stage, coalesce(count(c.previous_stage), 0)::bigint as total
  from buckets b
  left join classified c on c.previous_stage = b.previous_stage
  group by b.previous_stage
  order by array_position(
    array['sql', 'oportunidade', 'negociacao', 'sem_historico'],
    b.previous_stage
  )
$$;

-- ---------------------------------------------------------------------------
-- dashboard_loss_stage_reason_matrix: same deduped population × loss reason
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_loss_stage_reason_matrix(
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_campaign text default null,
  p_source text default null,
  p_medium text default null,
  p_owner text default null,
  p_stage public.qualification_stage default null
)
returns table (
  previous_stage text,
  reason text,
  total bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with population as (
    select *
    from public.dashboard_loss_events_deduped(
      p_tenant_id, p_from, p_to, p_campaign, p_source, p_medium, p_owner, p_stage
    )
  )
  select
    case
      when p.has_history
        and p.from_qualification in (
          'sql'::public.qualification_stage,
          'oportunidade'::public.qualification_stage,
          'negociacao'::public.qualification_stage
        )
        then p.from_qualification::text
      else 'sem_historico'
    end as previous_stage,
    coalesce(nullif(btrim(public.dashboard_loss_reason(l.custom_fields)), ''), 'Sem motivo') as reason,
    count(*)::bigint as total
  from population p
  join public.leads l
    on l.id = p.lead_id
   and l.tenant_id = p_tenant_id
  group by 1, 2
  order by total desc, previous_stage asc, reason asc
$$;

-- ---------------------------------------------------------------------------
-- dashboard_stagnant_open_leads: open commercial leads by owner × stage × age
-- Buckets (exclusive, only ≥3d): 3 | 7 | 15 | 30+
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_stagnant_open_leads(
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_campaign text default null,
  p_source text default null,
  p_medium text default null,
  p_owner text default null,
  p_stage public.qualification_stage default null
)
returns table (
  owner_id text,
  stage public.qualification_stage,
  bucket text,
  total bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as (
    select l.id, l.qualification, l.responsible_user_id, l.first_seen_at
    from public.leads l
    cross join lateral (
      select public.dashboard_reached_stages(l.qualification, l.custom_fields) as reached
      offset 0
    ) r
    where l.tenant_id = p_tenant_id
      and l.qualification in (
        'sql'::public.qualification_stage,
        'oportunidade'::public.qualification_stage,
        'negociacao'::public.qualification_stage
      )
      and l.first_seen_at >= p_from
      and l.first_seen_at < p_to
      and public.dashboard_dim_match(l.utm_campaign, p_campaign)
      and public.dashboard_dim_match(l.utm_source, p_source)
      and public.dashboard_dim_match(l.utm_medium, p_medium)
      and public.dashboard_dim_match(l.responsible_user_id, p_owner)
      and (p_stage is null or p_stage = any (r.reached))
  ),
  entered as (
    select distinct on (h.lead_id)
      h.lead_id,
      h.changed_at as entered_at
    from public.qualification_history h
    join scoped s on s.id = h.lead_id and s.qualification = h.to_qualification
    where h.tenant_id = p_tenant_id
      and coalesce(h.metadata ->> 'inferred', '') <> 'true'
    order by h.lead_id, h.changed_at desc, h.id desc
  ),
  aged as (
    select
      coalesce(nullif(btrim(s.responsible_user_id), ''), '') as owner_id,
      s.qualification as stage,
      extract(epoch from (now() - coalesce(e.entered_at, s.first_seen_at))) / 86400.0 as days
    from scoped s
    left join entered e on e.lead_id = s.id
  ),
  bucketed as (
    select
      a.owner_id,
      a.stage,
      case
        when a.days >= 30 then '30+'
        when a.days >= 15 then '15'
        when a.days >= 7 then '7'
        when a.days >= 3 then '3'
        else null
      end as bucket
    from aged a
  )
  select
    b.owner_id,
    b.stage,
    b.bucket,
    count(*)::bigint as total
  from bucketed b
  where b.bucket is not null
  group by b.owner_id, b.stage, b.bucket
  order by b.owner_id, b.stage, b.bucket
$$;

-- ---------------------------------------------------------------------------
-- dashboard_close_cycle_stats: median days to venda/perda + recovered losses
-- Medians only count closes with a reliable non-inferred commercial entry.
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_close_cycle_stats(
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_campaign text default null,
  p_source text default null,
  p_medium text default null,
  p_owner text default null,
  p_stage public.qualification_stage default null
)
returns table (
  median_days_to_venda numeric,
  venda_sample_size bigint,
  median_days_to_perda numeric,
  perda_sample_size bigint,
  recovered_to_venda bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as (
    select
      l.id,
      l.qualification,
      l.closed_at,
      public.dashboard_reached_stages(l.qualification, l.custom_fields) as reached
    from public.leads l
    where l.tenant_id = p_tenant_id
      and public.dashboard_dim_match(l.utm_campaign, p_campaign)
      and public.dashboard_dim_match(l.utm_source, p_source)
      and public.dashboard_dim_match(l.utm_medium, p_medium)
      and public.dashboard_dim_match(l.responsible_user_id, p_owner)
  ),
  closed as (
    select s.id, s.qualification, s.closed_at
    from scoped s
    where s.qualification in (
        'venda'::public.qualification_stage,
        'perda'::public.qualification_stage
      )
      and s.closed_at >= p_from
      and s.closed_at < p_to
      and (p_stage is null or p_stage = any (s.reached))
  ),
  commercial_entry as (
    select
      h.lead_id,
      min(h.changed_at) as entered_at
    from public.qualification_history h
    join closed c on c.id = h.lead_id
    where h.tenant_id = p_tenant_id
      and h.to_qualification in (
        'sql'::public.qualification_stage,
        'oportunidade'::public.qualification_stage,
        'negociacao'::public.qualification_stage
      )
      and coalesce(h.metadata ->> 'inferred', '') <> 'true'
    group by h.lead_id
  ),
  cycles as (
    select
      c.qualification,
      extract(epoch from (c.closed_at - e.entered_at)) / 86400.0 as days
    from closed c
    join commercial_entry e on e.lead_id = c.id
    where c.closed_at > e.entered_at
      and extract(epoch from (c.closed_at - e.entered_at)) >= 60
  ),
  recovered as (
    select count(distinct c.id)::bigint as total
    from closed c
    where c.qualification = 'venda'
      and exists (
        select 1
        from public.qualification_history hp
        where hp.tenant_id = p_tenant_id
          and hp.lead_id = c.id
          and hp.to_qualification = 'perda'
          and coalesce(hp.metadata ->> 'inferred', '') <> 'true'
      )
      and exists (
        select 1
        from public.qualification_history hv
        where hv.tenant_id = p_tenant_id
          and hv.lead_id = c.id
          and hv.to_qualification = 'venda'
          and coalesce(hv.metadata ->> 'inferred', '') <> 'true'
          and hv.changed_at > (
            select min(hp2.changed_at)
            from public.qualification_history hp2
            where hp2.tenant_id = p_tenant_id
              and hp2.lead_id = c.id
              and hp2.to_qualification = 'perda'
              and coalesce(hp2.metadata ->> 'inferred', '') <> 'true'
          )
      )
  )
  select
    (
      select round((percentile_cont(0.5) within group (order by cy.days))::numeric, 1)
      from cycles cy
      where cy.qualification = 'venda'
    ) as median_days_to_venda,
    (select count(*) from cycles cy where cy.qualification = 'venda') as venda_sample_size,
    (
      select round((percentile_cont(0.5) within group (order by cy.days))::numeric, 1)
      from cycles cy
      where cy.qualification = 'perda'
    ) as median_days_to_perda,
    (select count(*) from cycles cy where cy.qualification = 'perda') as perda_sample_size,
    coalesce((select r.total from recovered r), 0) as recovered_to_venda
$$;

revoke all on function public.dashboard_dimension_performance(
  uuid, timestamptz, timestamptz, text, text, text, text, text, text, public.qualification_stage
) from public, anon;
revoke all on function public.dashboard_loss_events_deduped(
  uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage
) from public, anon;
revoke all on function public.dashboard_loss_previous_stage(
  uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage
) from public, anon;
revoke all on function public.dashboard_loss_stage_reason_matrix(
  uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage
) from public, anon;
revoke all on function public.dashboard_stagnant_open_leads(
  uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage
) from public, anon;
revoke all on function public.dashboard_close_cycle_stats(
  uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage
) from public, anon;

grant execute on function public.dashboard_dimension_performance(
  uuid, timestamptz, timestamptz, text, text, text, text, text, text, public.qualification_stage
) to authenticated, service_role;
grant execute on function public.dashboard_loss_events_deduped(
  uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage
) to authenticated, service_role;
grant execute on function public.dashboard_loss_previous_stage(
  uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage
) to authenticated, service_role;
grant execute on function public.dashboard_loss_stage_reason_matrix(
  uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage
) to authenticated, service_role;
grant execute on function public.dashboard_stagnant_open_leads(
  uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage
) to authenticated, service_role;
grant execute on function public.dashboard_close_cycle_stats(
  uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage
) to authenticated, service_role;
