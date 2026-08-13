-- Align receita_fechada and loss reasons with closed outcomes semantics.

create or replace function public.dashboard_stage_counts(
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
  leads_total bigint,
  mql bigint,
  sal bigint,
  sql bigint,
  oportunidade bigint,
  negociacao bigint,
  venda bigint,
  perda bigint,
  receita_fechada numeric,
  utm_complete bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) as leads_total,
    count(*) filter (where 'mql' = any (r.reached)) as mql,
    count(*) filter (where 'sal' = any (r.reached)) as sal,
    count(*) filter (where 'sql' = any (r.reached)) as sql,
    count(*) filter (where 'oportunidade' = any (r.reached)) as oportunidade,
    count(*) filter (where 'negociacao' = any (r.reached)) as negociacao,
    count(*) filter (where 'venda' = any (r.reached)) as venda,
    count(*) filter (where 'perda' = any (r.reached)) as perda,
    coalesce(
      (
        select sum(l2.price)
        from public.leads l2
        where l2.tenant_id = p_tenant_id
          and l2.qualification = 'venda'
          and l2.price is not null
          and l2.closed_at >= p_from
          and l2.closed_at < p_to
          and public.dashboard_dim_match(l2.utm_campaign, p_campaign)
          and public.dashboard_dim_match(l2.utm_source, p_source)
          and public.dashboard_dim_match(l2.utm_medium, p_medium)
          and public.dashboard_dim_match(l2.responsible_user_id, p_owner)
          and (
            p_stage is null
            or p_stage = any (
              public.dashboard_reached_stages(l2.qualification, l2.custom_fields)
            )
          )
      ),
      0
    ) as receita_fechada,
    count(*) filter (
      where coalesce(l.utm_source, '') <> ''
        and coalesce(l.utm_medium, '') <> ''
        and coalesce(l.utm_campaign, '') <> ''
        and coalesce(l.utm_content, '') <> ''
        and coalesce(l.utm_term, '') <> ''
    ) as utm_complete
  from public.leads l
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
    and (p_stage is null or p_stage = any (r.reached));
$$;

create or replace function public.dashboard_loss_reasons(
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_campaign text default null,
  p_source text default null,
  p_medium text default null,
  p_owner text default null,
  p_stage public.qualification_stage default null
)
returns table (name text, value bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select lr.reason as name, count(*) as value
  from public.leads l
  cross join lateral (
    select btrim(v.value) as reason
    from jsonb_each_text(coalesce(l.custom_fields, '{}'::jsonb)) as v(key, value)
    where btrim(coalesce(v.value, '')) <> ''
      and case
        when strpos(lower(translate(
               v.key,
               'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
               'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'
             )), 'motivo') = 0
         and strpos(lower(v.key), 'loss') = 0 then false
        else regexp_replace(
               lower(translate(
                 v.key,
                 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
                 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'
               )),
               '[^a-z0-9]+', '_', 'g'
             ) in ('motivo_de_perda', 'motivo_perda', 'loss_reason')
      end
    limit 1
  ) lr
  where l.tenant_id = p_tenant_id
    and l.qualification = 'perda'
    and l.closed_at >= p_from
    and l.closed_at < p_to
    and public.dashboard_dim_match(l.utm_campaign, p_campaign)
    and public.dashboard_dim_match(l.utm_source, p_source)
    and public.dashboard_dim_match(l.utm_medium, p_medium)
    and public.dashboard_dim_match(l.responsible_user_id, p_owner)
    and (p_stage is null or p_stage = any (public.dashboard_reached_stages(l.qualification, l.custom_fields)))
  group by lr.reason
  order by value desc, name asc;
$$;

-- Stage dwell: scope open leads by first_seen in period (align with date filter).
create or replace function public.dashboard_stage_dwell(
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
  stage public.qualification_stage,
  open_leads bigint,
  median_current_days numeric,
  stuck_7d bigint,
  completed_stays bigint,
  median_cycle_days numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped_leads as (
    select l.id, l.qualification
    from public.leads l
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
  ),
  transitions as (
    select
      h.lead_id,
      h.to_qualification as stage,
      h.changed_at as entered_at,
      lead(h.changed_at) over (
        partition by h.lead_id order by h.changed_at, h.id
      ) as left_at
    from public.qualification_history h
    join scoped_leads sl on sl.id = h.lead_id
    where h.tenant_id = p_tenant_id
  ),
  current_dwell as (
    select t.stage, extract(epoch from (now() - t.entered_at)) / 86400.0 as days
    from (
      select distinct on (t.lead_id)
        t.lead_id, t.stage, t.entered_at
      from transitions t
      order by t.lead_id, t.entered_at desc
    ) t
    join scoped_leads sl on sl.id = t.lead_id and sl.qualification = t.stage
    where t.stage in ('mql', 'sal', 'sql', 'oportunidade', 'negociacao')
  ),
  cycles as (
    select
      t.stage,
      extract(epoch from (t.left_at - t.entered_at)) / 86400.0 as days
    from transitions t
    where t.left_at is not null
      and t.left_at >= p_from
      and t.left_at < p_to
      and t.stage in ('mql', 'sal', 'sql', 'oportunidade', 'negociacao')
      and extract(epoch from (t.left_at - t.entered_at)) >= 60
  ),
  stages as (
    select unnest(array[
      'mql'::public.qualification_stage,
      'sal'::public.qualification_stage,
      'sql'::public.qualification_stage,
      'oportunidade'::public.qualification_stage,
      'negociacao'::public.qualification_stage
    ]) as stage
  )
  select
    s.stage,
    coalesce((select count(*) from current_dwell d where d.stage = s.stage), 0) as open_leads,
    (
      select percentile_cont(0.5) within group (order by d.days)
      from current_dwell d
      where d.stage = s.stage
    ) as median_current_days,
    coalesce((
      select count(*) from current_dwell d
      where d.stage = s.stage and d.days >= 7
    ), 0) as stuck_7d,
    coalesce((select count(*) from cycles c where c.stage = s.stage), 0) as completed_stays,
    (
      select percentile_cont(0.5) within group (order by c.days)
      from cycles c
      where c.stage = s.stage
    ) as median_cycle_days
  from stages s
  order by array_position(
    array[
      'mql'::public.qualification_stage,
      'sal'::public.qualification_stage,
      'sql'::public.qualification_stage,
      'oportunidade'::public.qualification_stage,
      'negociacao'::public.qualification_stage
    ],
    s.stage
  );
$$;
