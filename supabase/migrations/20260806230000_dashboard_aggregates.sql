-- Dashboard aggregates: move heavy per-lead aggregation from Node into Postgres.
-- All functions are SECURITY INVOKER so RLS keeps applying; grants mirror table access.
--
-- Semantics mirror src/lib/dashboard-filters.ts exactly:
--   * leadReachedStages: enum-derived milestones OR custom_fields flags (stage / STAGE keys)
--   * matchesNullableDimension: null filter = no-op, '__none__' = blank column, else trimmed equality
--   * trend: São Paulo calendar-day buckets, excluding metadata->>'inferred' = 'true'

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Mirrors isActiveMilestone(): true/1/sim/yes/ativo/active (accent/case-insensitive).
-- Sem SET search_path: funções com proconfig não são inlined pelo planner e
-- estes helpers rodam por linha × estágio. Todas as referências são
-- schema-qualificadas ou built-ins, então não há risco de hijack.
create or replace function public.dashboard_milestone_active(v text)
returns boolean
language sql
immutable
parallel safe
as $$
  select btrim(lower(coalesce(
    translate(
      v,
      'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
      'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'
    ),
    ''
  ))) in ('1', 'true', 'sim', 'yes', 'ativo', 'active')
$$;

-- Mirrors leadReachedStages(lead).has(target) for a single stage.
create or replace function public.dashboard_lead_reached(
  q public.qualification_stage,
  cf jsonb,
  target public.qualification_stage
)
returns boolean
language sql
immutable
parallel safe
as $$
  select
    (
      q is not null
      and (
        (target = 'perda' and q = 'perda')
        or (
          target <> 'perda'
          and q <> 'perda'
          and array_position(
                array['mql','sal','sql','oportunidade','negociacao','venda'],
                target::text
              )
              <= array_position(
                array['mql','sal','sql','oportunidade','negociacao','venda'],
                q::text
              )
        )
      )
    )
    or public.dashboard_milestone_active(cf ->> (target::text))
    or public.dashboard_milestone_active(cf ->> upper(target::text))
$$;

-- Mirrors leadReachedStages(lead) inteiro: uma chamada por linha, detoast do
-- custom_fields uma única vez (plpgsql copia o jsonb para a variável local).
create or replace function public.dashboard_reached_stages(
  q public.qualification_stage,
  cf jsonb
)
returns public.qualification_stage[]
language plpgsql
immutable
parallel safe
as $fn$
declare
  fields jsonb := coalesce(cf, '{}'::jsonb);
  positive constant text[] := array['mql','sal','sql','oportunidade','negociacao','venda'];
  active constant text[] := array['1', 'true', 'sim', 'yes', 'ativo', 'active'];
  reached text[] := '{}';
  s text;
  v text;
  q_rank int;
begin
  if q = 'perda' then
    reached := array['perda'];
  elsif q is not null then
    q_rank := array_position(positive, q::text);
    if q_rank is not null then
      reached := positive[1:q_rank];
    end if;
  end if;

  -- Checagem de milestone inline (sem chamadas de função por chave — custo
  -- por linha importa: roda para todo lead do período).
  foreach s in array (positive || array['perda']) loop
    continue when s = any (reached);
    v := coalesce(fields ->> s, fields ->> upper(s));
    continue when v is null;
    if btrim(lower(translate(
         v,
         'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
         'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'
       ))) = any (active)
    then
      reached := reached || s;
    elsif fields ? s and fields ? upper(s) then
      -- Chave minúscula presente mas inativa: ainda precisa testar a maiúscula
      -- (o JS aplica OR entre as duas).
      v := fields ->> upper(s);
      if v is not null and btrim(lower(translate(
           v,
           'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
           'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'
         ))) = any (active)
      then
        reached := reached || s;
      end if;
    end if;
  end loop;

  return reached::public.qualification_stage[];
end;
$fn$;

-- Mirrors matchesNullableDimension(columnValue, filterValue).
create or replace function public.dashboard_dim_match(col text, filt text)
returns boolean
language sql
immutable
parallel safe
as $$
  select
    filt is null
    or (filt = '__none__' and (col is null or btrim(col) = ''))
    or btrim(coalesce(col, '')) = filt
$$;

-- Mirrors lossReason(lead): first custom field whose normalized key is a loss-reason alias.
create or replace function public.dashboard_loss_reason(cf jsonb)
returns text
language sql
immutable
parallel safe
as $$
  select btrim(v.value)
  from jsonb_each_text(coalesce(cf, '{}'::jsonb)) as v(key, value)
  where regexp_replace(
          lower(translate(
            v.key,
            'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
            'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'
          )),
          '[^a-z0-9]+', '_', 'g'
        ) in ('motivo_de_perda', 'motivo_perda', 'loss_reason')
    and btrim(coalesce(v.value, '')) <> ''
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- dashboard_stage_counts: one row with per-stage reach counts + revenue + UTM coverage
-- ---------------------------------------------------------------------------

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
    coalesce(sum(l.price) filter (where l.qualification = 'venda' and l.price is not null), 0) as receita_fechada,
    count(*) filter (
      where coalesce(l.utm_source, '') <> ''
        and coalesce(l.utm_medium, '') <> ''
        and coalesce(l.utm_campaign, '') <> ''
        and coalesce(l.utm_content, '') <> ''
        and coalesce(l.utm_term, '') <> ''
    ) as utm_complete
  from public.leads l
  cross join lateral (
    -- OFFSET 0 impede o pull-up do subquery: sem ele o planner substitui a
    -- expressão em cada referência a r.reached (9 chamadas por linha).
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
$$;

-- ---------------------------------------------------------------------------
-- dashboard_dimension_performance: GROUP BY a UTM dimension with stage-reach counts
-- (campaigns, creatives via utm_content, sources via utm_source)
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
    end as value
  ) d
  cross join lateral (
    -- OFFSET 0 impede o pull-up do subquery: sem ele o planner substitui a
    -- expressão em cada referência a r.reached (9 chamadas por linha).
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
-- dashboard_filter_options: distinct dimension values in the date window only
-- (value = null flags "blank present" for the "Sem …" option)
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_filter_options(
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (dimension text, value text)
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as (
    select l.utm_campaign, l.utm_source, l.utm_medium, l.responsible_user_id
    from public.leads l
    where l.tenant_id = p_tenant_id
      and l.first_seen_at >= p_from
      and l.first_seen_at < p_to
  )
  select 'campaign'::text, nullif(btrim(coalesce(utm_campaign, '')), '') from scoped group by 2
  union all
  select 'source'::text, nullif(btrim(coalesce(utm_source, '')), '') from scoped group by 2
  union all
  select 'medium'::text, nullif(btrim(coalesce(utm_medium, '')), '') from scoped group by 2
  union all
  select 'owner'::text, nullif(btrim(coalesce(responsible_user_id, '')), '') from scoped group by 2
$$;

-- ---------------------------------------------------------------------------
-- dashboard_trend: non-inferred qualification events bucketed by São Paulo day,
-- restricted to leads matching the dashboard filters
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_trend(
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
  day text,
  stage public.qualification_stage,
  total bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    to_char(h.changed_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as day,
    h.to_qualification as stage,
    count(*) as total
  from public.qualification_history h
  join public.leads l on l.id = h.lead_id
  where h.tenant_id = p_tenant_id
    and h.changed_at >= p_from
    and h.changed_at < p_to
    and coalesce(h.metadata ->> 'inferred', '') <> 'true'
    and l.tenant_id = p_tenant_id
    and l.first_seen_at >= p_from
    and l.first_seen_at < p_to
    and public.dashboard_dim_match(l.utm_campaign, p_campaign)
    and public.dashboard_dim_match(l.utm_source, p_source)
    and public.dashboard_dim_match(l.utm_medium, p_medium)
    and public.dashboard_dim_match(l.responsible_user_id, p_owner)
    and (p_stage is null or p_stage = any (public.dashboard_reached_stages(l.qualification, l.custom_fields)))
  group by 1, 2
  order by 1 asc
$$;

-- ---------------------------------------------------------------------------
-- dashboard_loss_reasons: loss-reason counts across filtered leads
-- ---------------------------------------------------------------------------

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
  -- Lateral em vez de função escalar: evita overhead SPI por linha.
  select lr.reason as name, count(*) as value
  from public.leads l
  cross join lateral (
    select btrim(v.value) as reason
    from jsonb_each_text(coalesce(l.custom_fields, '{}'::jsonb)) as v(key, value)
    where btrim(coalesce(v.value, '')) <> ''
      -- CASE garante o pré-filtro barato antes do regexp (custa ~4µs/chave).
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
    and l.first_seen_at >= p_from
    and l.first_seen_at < p_to
    -- Pré-filtro barato no documento inteiro: evita o jsonb_each_text
    -- (SRF ~0,1ms/linha) em leads sem nenhuma chave/valor candidato.
    -- Sem translate (O(n×m) ficava caro); só perde chaves com acento dentro
    -- de "motivo"/"loss", cenário irreal para nomes de campo do Kommo.
    and (
      lower(l.custom_fields::text) like '%motivo%'
      or lower(l.custom_fields::text) like '%loss%'
    )
    and public.dashboard_dim_match(l.utm_campaign, p_campaign)
    and public.dashboard_dim_match(l.utm_source, p_source)
    and public.dashboard_dim_match(l.utm_medium, p_medium)
    and public.dashboard_dim_match(l.responsible_user_id, p_owner)
    and (p_stage is null or p_stage = any (public.dashboard_reached_stages(l.qualification, l.custom_fields)))
  group by lr.reason
  order by value desc, name asc
$$;

-- ---------------------------------------------------------------------------
-- dashboard_aging: updated_at buckets over "commercial" leads (reached sql+)
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_aging(
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
  with commercial as (
    select extract(epoch from (now() - l.updated_at)) / 86400.0 as days
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
      and r.reached && array['sql','oportunidade','negociacao','venda','perda']::public.qualification_stage[]
  )
  select b.name, count(c.days) as value
  from (
    values
      (1, 'Até 3 dias', 0::float8, 3::float8),
      (2, '4–7 dias', 3::float8, 7::float8),
      (3, '8–14 dias', 7::float8, 14::float8),
      (4, '15+ dias', 14::float8, 'infinity'::float8)
  ) as b(ord, name, lo, hi)
  left join commercial c on c.days > b.lo and c.days <= b.hi
  group by b.ord, b.name
  order by b.ord
$$;

-- ---------------------------------------------------------------------------
-- dashboard_recent_leads: latest commercial leads (small, bounded payload)
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_recent_leads(
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_campaign text default null,
  p_source text default null,
  p_medium text default null,
  p_owner text default null,
  p_stage public.qualification_stage default null,
  p_limit int default 20
)
returns table (
  id uuid,
  kommo_lead_id text,
  name text,
  qualification public.qualification_stage,
  utm_campaign text,
  loss_reason text,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    l.id,
    l.kommo_lead_id,
    l.name,
    l.qualification,
    l.utm_campaign,
    public.dashboard_loss_reason(l.custom_fields) as loss_reason,
    l.updated_at
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
    and r.reached && array['sql','oportunidade','negociacao','venda','perda']::public.qualification_stage[]
  order by l.updated_at desc
  limit greatest(coalesce(p_limit, 20), 1)
$$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated (RLS-scoped) + service_role; nothing for anon/public
-- ---------------------------------------------------------------------------

revoke all on function public.dashboard_milestone_active(text) from public, anon;
revoke all on function public.dashboard_lead_reached(public.qualification_stage, jsonb, public.qualification_stage) from public, anon;
revoke all on function public.dashboard_reached_stages(public.qualification_stage, jsonb) from public, anon;
revoke all on function public.dashboard_dim_match(text, text) from public, anon;
revoke all on function public.dashboard_loss_reason(jsonb) from public, anon;
revoke all on function public.dashboard_stage_counts(uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage) from public, anon;
revoke all on function public.dashboard_dimension_performance(uuid, timestamptz, timestamptz, text, text, text, text, text, text, public.qualification_stage) from public, anon;
revoke all on function public.dashboard_filter_options(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.dashboard_trend(uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage) from public, anon;
revoke all on function public.dashboard_loss_reasons(uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage) from public, anon;
revoke all on function public.dashboard_aging(uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage) from public, anon;
revoke all on function public.dashboard_recent_leads(uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage, int) from public, anon;

grant execute on function public.dashboard_milestone_active(text) to authenticated, service_role;
grant execute on function public.dashboard_lead_reached(public.qualification_stage, jsonb, public.qualification_stage) to authenticated, service_role;
grant execute on function public.dashboard_reached_stages(public.qualification_stage, jsonb) to authenticated, service_role;
grant execute on function public.dashboard_dim_match(text, text) to authenticated, service_role;
grant execute on function public.dashboard_loss_reason(jsonb) to authenticated, service_role;
grant execute on function public.dashboard_stage_counts(uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage) to authenticated, service_role;
grant execute on function public.dashboard_dimension_performance(uuid, timestamptz, timestamptz, text, text, text, text, text, text, public.qualification_stage) to authenticated, service_role;
grant execute on function public.dashboard_filter_options(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.dashboard_trend(uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage) to authenticated, service_role;
grant execute on function public.dashboard_loss_reasons(uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage) to authenticated, service_role;
grant execute on function public.dashboard_aging(uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage) to authenticated, service_role;
grant execute on function public.dashboard_recent_leads(uuid, timestamptz, timestamptz, text, text, text, text, public.qualification_stage, int) to authenticated, service_role;
