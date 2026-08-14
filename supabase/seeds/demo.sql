-- Dados inteiramente fictícios para preencher os dashboards do Venda+.
-- Requer uma empresa dedicada, sem Kommo conectado ou Meta CAPI habilitada.
-- É idempotente: os IDs demo são estáveis e reexecuções atualizam os registros.

do $guard$
declare
  v_tenant_id uuid;
begin
  select id into v_tenant_id from public.tenants where slug = '__DEMO_TENANT_SLUG__';
  if v_tenant_id is null then raise exception 'demo_tenant_not_found'; end if;

  if exists (
    select 1 from public.kommo_connections
    where tenant_id = v_tenant_id and status = 'connected'
  ) then
    raise exception 'demo_refused_kommo_connected';
  end if;

  if exists (
    select 1 from public.meta_capi_connections
    where tenant_id = v_tenant_id and is_enabled
  ) then
    raise exception 'demo_refused_meta_capi_enabled';
  end if;
end;
$guard$;

with params as (
  select id as tenant_id from public.tenants where slug = '__DEMO_TENANT_SLUG__'
), rows as (
  select
    p.tenant_id,
    i,
    'demo-contact-' || lpad(i::text, 3, '0') as kommo_contact_id,
    (array['Ana Horizonte', 'Bruno Vale', 'Carla Sol', 'Diego Mar', 'Elisa Serra', 'Fábio Lima'])[
      1 + ((i - 1) % 6)
    ] || ' ' || lpad(i::text, 2, '0') as contact_name
  from params p cross join generate_series(1, 42) as i
)
insert into public.contacts (
  tenant_id, kommo_contact_id, name, email, phone, company, raw,
  first_seen_at, last_seen_at, created_at, updated_at
)
select
  tenant_id,
  kommo_contact_id,
  contact_name,
  'lead-' || lpad(i::text, 3, '0') || '@vendaplus.example',
  '+550000' || lpad(i::text, 6, '0'),
  (array['Aurora Viagens', 'Caminho Livre', 'Estação Demo', 'Horizonte Azul'])[
    1 + ((i - 1) % 4)
  ],
  jsonb_build_object('demo', true, 'generated_by', 'vendaplus'),
  now() - make_interval(days => 2 + ((i * 7) % 55)),
  now() - make_interval(hours => i % 48),
  now() - make_interval(days => 2 + ((i * 7) % 55)),
  now()
from rows
on conflict (tenant_id, kommo_contact_id) do update set
  name = excluded.name,
  email = excluded.email,
  phone = excluded.phone,
  company = excluded.company,
  raw = excluded.raw,
  first_seen_at = excluded.first_seen_at,
  last_seen_at = excluded.last_seen_at,
  updated_at = now();

with params as (
  select id as tenant_id from public.tenants where slug = '__DEMO_TENANT_SLUG__'
), rows as (
  select
    p.tenant_id,
    c.id as contact_id,
    i,
    'demo-lead-' || lpad(i::text, 3, '0') as kommo_lead_id,
    (array['mql', 'sal', 'sql', 'oportunidade', 'negociacao', 'venda', 'perda']::public.qualification_stage[])[
      1 + ((i - 1) % 7)
    ] as qualification,
    now() - make_interval(days => 2 + ((i * 7) % 55)) as first_seen_at
  from params p
  cross join generate_series(1, 42) as i
  join public.contacts c
    on c.tenant_id = p.tenant_id
   and c.kommo_contact_id = 'demo-contact-' || lpad(i::text, 3, '0')
), enriched as (
  select
    r.*,
    (array['Meta ADS', 'Instagram', 'Google', 'Indicação'])[1 + ((i - 1) % 4)] as utm_source,
    (array['paid_social', 'organic_social', 'cpc', 'referral'])[1 + ((i - 1) % 4)] as utm_medium,
    (array['demo_tanzania', 'demo_zanzibar', 'demo_safari'])[1 + ((i - 1) % 3)] as utm_campaign,
    (array['video_destino', 'carrossel_roteiro', 'bio', 'parceiro'])[1 + ((i - 1) % 4)] as utm_content,
    (array['familias', 'casais', 'aventura'])[1 + ((i - 1) % 3)] as utm_term,
    (array['demo-ana', 'demo-bruno', 'demo-carla'])[1 + ((i - 1) % 3)] as responsible_user_id
  from rows r
)
insert into public.leads (
  tenant_id, contact_id, kommo_lead_id, name, pipeline_id, status_id,
  status_name, price, responsible_user_id, qualification, utm_source,
  utm_medium, utm_campaign, utm_content, utm_term, custom_fields, raw,
  closed_at, first_seen_at, last_seen_at, created_at, updated_at
)
select
  tenant_id,
  contact_id,
  kommo_lead_id,
  'Viagem demonstrativa ' || lpad(i::text, 2, '0'),
  'demo-pipeline-vendas',
  'demo-status-' || qualification::text,
  initcap(replace(qualification::text, '_', ' ')),
  case
    when qualification = 'venda' then 12000 + (i * 375)
    when qualification in ('oportunidade', 'negociacao') then 9000 + (i * 250)
    else null
  end,
  responsible_user_id,
  qualification,
  utm_source,
  utm_medium,
  utm_campaign,
  utm_content,
  utm_term,
  jsonb_strip_nulls(jsonb_build_object(
    'demo', true,
    'mql', case when qualification = 'perda' then '1' else null end,
    'sal', case when qualification = 'perda' then '1' else null end,
    'sql', case when qualification = 'perda' then '1' else null end,
    'motivo_de_perda', case when qualification = 'perda' then
      (array['Sem disponibilidade', 'Orçamento', 'Período incompatível'])[1 + ((i - 1) % 3)]
      else null end
  )),
  jsonb_build_object('demo', true, 'generated_by', 'vendaplus'),
  case when qualification in ('venda', 'perda')
    then least(now() - interval '1 hour', first_seen_at + make_interval(days => 3 + (i % 12)))
    else null end,
  first_seen_at,
  now() - make_interval(hours => i % 48),
  first_seen_at,
  now()
from enriched
on conflict (tenant_id, kommo_lead_id) do update set
  contact_id = excluded.contact_id,
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
  closed_at = excluded.closed_at,
  first_seen_at = excluded.first_seen_at,
  last_seen_at = excluded.last_seen_at,
  updated_at = now();

with demo_leads as (
  select
    l.id as lead_id,
    l.tenant_id,
    l.kommo_lead_id,
    l.qualification,
    l.first_seen_at,
    case
      when l.qualification = 'perda' then
        array['mql', 'sal', 'sql', 'perda']::public.qualification_stage[]
      else
        (array['mql', 'sal', 'sql', 'oportunidade', 'negociacao', 'venda']::public.qualification_stage[])[
          1:array_position(
            array['mql', 'sal', 'sql', 'oportunidade', 'negociacao', 'venda']::public.qualification_stage[],
            l.qualification
          )
        ]
    end as stages
  from public.leads l
  where l.tenant_id = (select id from public.tenants where slug = '__DEMO_TENANT_SLUG__')
    and l.raw ->> 'demo' = 'true'
), transitions as (
  select
    d.*,
    stage,
    ordinality,
    md5(d.tenant_id::text || ':' || d.kommo_lead_id || ':' || stage::text) as hash
  from demo_leads d
  cross join lateral unnest(d.stages) with ordinality as s(stage, ordinality)
)
insert into public.qualification_history (
  id, tenant_id, lead_id, from_qualification, to_qualification,
  source, changed_at, metadata, created_at
)
select
  (substr(hash, 1, 8) || '-' || substr(hash, 9, 4) || '-' || substr(hash, 13, 4) || '-' ||
   substr(hash, 17, 4) || '-' || substr(hash, 21, 12))::uuid,
  tenant_id,
  lead_id,
  lag(stage) over (partition by lead_id order by ordinality),
  stage,
  'demo',
  least(now() - interval '1 hour', first_seen_at + make_interval(days => (ordinality - 1)::int * 2)),
  jsonb_build_object('demo', true, 'generated_by', 'vendaplus'),
  least(now() - interval '1 hour', first_seen_at + make_interval(days => (ordinality - 1)::int * 2))
from transitions
on conflict (id) do update set
  from_qualification = excluded.from_qualification,
  to_qualification = excluded.to_qualification,
  changed_at = excluded.changed_at,
  metadata = excluded.metadata;

select
  'vendaplus_demo_ready' as status,
  count(*) as demo_leads
from public.leads
where tenant_id = (select id from public.tenants where slug = '__DEMO_TENANT_SLUG__')
  and raw ->> 'demo' = 'true';
