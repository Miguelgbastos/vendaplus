-- dashboard_stage_dwell: per-stage time metrics for the commercial dashboard.
--   - "current dwell": how long open leads have been sitting in their current
--     stage (snapshot; ignores the first_seen_at window, dimension filters apply)
--   - "cycle time": how long completed stays took to leave each stage
--     (stays whose exit falls inside [p_from, p_to); stays under 60s are sync
--     noise — several stages recorded in a single sync — and are ignored)

create index if not exists qualification_history_tenant_to_qual_idx
  on public.qualification_history (tenant_id, to_qualification, changed_at desc);

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
    -- Latest entry into the lead's current stage; only open (non-closed) stages.
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
    -- Completed stays that ended inside the selected period, excluding
    -- sub-minute stays created when one sync records several transitions.
    select
      t.stage,
      extract(epoch from (t.left_at - t.entered_at)) / 86400.0 as days
    from transitions t
    where t.left_at is not null
      and t.left_at >= p_from
      and t.left_at < p_to
      and t.left_at - t.entered_at >= interval '60 seconds'
      and t.stage in ('mql', 'sal', 'sql', 'oportunidade', 'negociacao')
  ),
  stages as (
    select unnest(
      array['mql', 'sal', 'sql', 'oportunidade', 'negociacao']::public.qualification_stage[]
    ) as stage
  )
  select
    s.stage,
    count(d.days) as open_leads,
    round(
      (percentile_cont(0.5) within group (order by d.days))::numeric, 1
    ) as median_current_days,
    count(d.days) filter (where d.days >= 7) as stuck_7d,
    (select count(*) from cycles c where c.stage = s.stage) as completed_stays,
    (
      select round(
        (percentile_cont(0.5) within group (order by c.days))::numeric, 1
      )
      from cycles c
      where c.stage = s.stage
    ) as median_cycle_days
  from stages s
  left join current_dwell d on d.stage = s.stage
  group by s.stage
  order by array_position(
    array['mql', 'sal', 'sql', 'oportunidade', 'negociacao']::public.qualification_stage[],
    s.stage
  )
$$;

revoke all on function public.dashboard_stage_dwell(
  uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage
) from public, anon;

grant execute on function public.dashboard_stage_dwell(
  uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage
) to authenticated, service_role;
