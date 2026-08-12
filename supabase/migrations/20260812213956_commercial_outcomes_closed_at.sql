-- Prefer Kommo closed_at for outcome timing (won/lost), and expose
-- commercial outcome metrics by close date vs created+closed in period.

update public.leads
set
  closed_at = to_timestamp((raw->>'closed_at')::bigint),
  updated_at = now()
where raw ? 'closed_at'
  and (raw->>'closed_at') ~ '^[0-9]+$'
  and qualification in ('venda', 'perda')
  and closed_at is distinct from to_timestamp((raw->>'closed_at')::bigint);

update public.leads
set
  closed_at = null,
  updated_at = now()
where qualification is distinct from 'venda'
  and qualification is distinct from 'perda'
  and closed_at is not null;

create index if not exists leads_tenant_closed_at_idx
  on public.leads (tenant_id, closed_at desc);

create or replace function public.dashboard_commercial_outcomes(
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
  venda_fechada bigint,
  perda_fechada bigint,
  venda_mesmo_periodo bigint,
  perda_mesmo_periodo bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as (
    select
      l.qualification,
      l.first_seen_at,
      l.closed_at,
      public.dashboard_reached_stages(l.qualification, l.custom_fields) as reached
    from public.leads l
    where l.tenant_id = p_tenant_id
      and public.dashboard_dim_match(l.utm_campaign, p_campaign)
      and public.dashboard_dim_match(l.utm_source, p_source)
      and public.dashboard_dim_match(l.utm_medium, p_medium)
      and public.dashboard_dim_match(l.responsible_user_id, p_owner)
  )
  select
    count(*) filter (
      where s.qualification = 'venda'
        and s.closed_at >= p_from
        and s.closed_at < p_to
        and (p_stage is null or p_stage = any (s.reached))
    ) as venda_fechada,
    count(*) filter (
      where s.qualification = 'perda'
        and s.closed_at >= p_from
        and s.closed_at < p_to
        and (p_stage is null or p_stage = any (s.reached))
    ) as perda_fechada,
    count(*) filter (
      where s.qualification = 'venda'
        and s.first_seen_at >= p_from
        and s.first_seen_at < p_to
        and s.closed_at >= p_from
        and s.closed_at < p_to
        and (p_stage is null or p_stage = any (s.reached))
    ) as venda_mesmo_periodo,
    count(*) filter (
      where s.qualification = 'perda'
        and s.first_seen_at >= p_from
        and s.first_seen_at < p_to
        and s.closed_at >= p_from
        and s.closed_at < p_to
        and (p_stage is null or p_stage = any (s.reached))
    ) as perda_mesmo_periodo
  from scoped s;
$$;

revoke all on function public.dashboard_commercial_outcomes(
  uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage
) from public, anon;

grant execute on function public.dashboard_commercial_outcomes(
  uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage
) to authenticated, service_role;
