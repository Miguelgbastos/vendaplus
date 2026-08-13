-- Meta Ads (Facebook / Instagram) Conversions API — servidor de conversão por empresa.
-- - Pixel ID, Access Token (system user) e Test Event Code ficam por tenant.
-- - Token do CAPI é armazenado criptografado (AES-256-GCM via TOKEN_ENCRYPTION_KEY).
-- - Mapeamento por qualificação: qual estágio dispara qual evento (Lead/AddToCart/...)
--   e se o valor monetário do lead entra no evento.
-- - Log auditável dos eventos enviados (para debug e reconciliar Events Manager).
-- - Transactional outbox: cada qualification_history elegível cria o job CAPI na
--   mesma transação PostgreSQL, com event_id determinístico derivado do histórico.
--
-- RLS: metadados legíveis por membro; access_token só via service_role; escrita só
-- por owner/admin. Nenhum privilégio para anon.

create type public.meta_capi_status as enum (
  'pending',
  'configured',
  'connected',
  'disconnected',
  'error'
);

create type public.meta_capi_dispatch_status as enum (
  'received',
  'sent',
  'failed'
);

create table public.meta_capi_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pixel_id text,
  dataset_id text,
  access_token_encrypted text,
  test_event_code text,
  status public.meta_capi_status not null default 'pending',
  is_enabled boolean not null default false,
  last_error text,
  last_sent_at timestamptz,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_capi_connections_tenant_unique unique (tenant_id)
);

create trigger meta_capi_connections_set_updated_at
  before update on public.meta_capi_connections
  for each row execute function private.set_updated_at();

-- Mapa: estágio de qualificação normalizado (Venda+) → evento CAPI (nome padrão Meta).
-- Estágios usuais: mql, sal, sql, oportunidade, negociacao, venda, perda.
-- Eventos padrão do Meta: Lead, InitiateCheckout, AddPaymentInfo, Purchase, ...
create table public.meta_capi_event_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  qualification public.qualification_stage not null,
  event_name text not null,
  include_value boolean not null default true,
  currency text not null default 'BRL',
  is_active boolean not null default true,
  action_source text not null default 'system_generated',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_capi_event_mappings_tenant_qualification_unique
    unique (tenant_id, qualification)
);

create trigger meta_capi_event_mappings_set_updated_at
  before update on public.meta_capi_event_mappings
  for each row execute function private.set_updated_at();

create index meta_capi_event_mappings_tenant_idx
  on public.meta_capi_event_mappings (tenant_id) where is_active;

-- Log auditável dos eventos enviados. Guardamos o request_id/fbtrace_id retornado
-- pelo Meta, o status HTTP e um payload sanitizado para reduzir PII em repouso.
create table public.meta_capi_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  qualification public.qualification_stage,
  event_name text not null,
  event_id text not null,
  status public.meta_capi_dispatch_status not null default 'received',
  http_status int,
  fbtrace_id text,
  request_payload jsonb not null default '{}'::jsonb,
  response_body jsonb,
  error_message text,
  test_event_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint meta_capi_events_tenant_event_id_unique unique (tenant_id, event_id)
);

create index meta_capi_events_tenant_created_idx
  on public.meta_capi_events (tenant_id, created_at desc);
create index meta_capi_events_lead_idx
  on public.meta_capi_events (lead_id);
create index meta_capi_events_status_idx
  on public.meta_capi_events (tenant_id, status);

-- ---------------------------------------------------------------------------
-- Transactional outbox: qualification_history -> jobs(send_meta_capi_event)
-- ---------------------------------------------------------------------------

-- Garante que um mesmo event_id CAPI não origine mais de um job, mesmo que algum
-- caller futuro tente reconciliar/reinserir o mesmo evento.
create unique index jobs_meta_capi_event_id_unique
  on public.jobs ((payload ->> 'event_id'))
  where job_type = 'send_meta_capi_event'
    and payload ? 'event_id';

create or replace function private.enqueue_meta_capi_from_qualification_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.meta_capi_connections c
    join public.meta_capi_event_mappings m
      on m.tenant_id = c.tenant_id
     and m.qualification = new.to_qualification
    where c.tenant_id = new.tenant_id
      and c.is_enabled = true
      and c.pixel_id is not null
      and c.access_token_encrypted is not null
      and m.is_active = true
  ) then
    insert into public.jobs (
      tenant_id,
      job_type,
      status,
      priority,
      payload,
      max_attempts
    ) values (
      new.tenant_id,
      'send_meta_capi_event',
      'pending',
      200,
      jsonb_build_object(
        'lead_id', new.lead_id,
        'qualification', new.to_qualification,
        'occurred_at', new.changed_at,
        'event_id', 'qh-' || new.id::text,
        'qualification_history_id', new.id
      ),
      5
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;

revoke all on function private.enqueue_meta_capi_from_qualification_history() from public;
grant execute on function private.enqueue_meta_capi_from_qualification_history()
  to postgres, service_role;

create trigger qualification_history_enqueue_meta_capi
  after insert on public.qualification_history
  for each row execute function private.enqueue_meta_capi_from_qualification_history();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.meta_capi_connections enable row level security;
alter table public.meta_capi_event_mappings enable row level security;
alter table public.meta_capi_events enable row level security;

-- Metadados legíveis por qualquer membro; access_token só para service_role via grants.
create policy meta_capi_connections_select_member
  on public.meta_capi_connections for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy meta_capi_event_mappings_select_member
  on public.meta_capi_event_mappings for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy meta_capi_event_mappings_insert_admin
  on public.meta_capi_event_mappings for insert to authenticated
  with check (
    public.has_tenant_role(
      tenant_id,
      array['owner', 'admin']::public.tenant_role[]
    )
  );

create policy meta_capi_event_mappings_update_admin
  on public.meta_capi_event_mappings for update to authenticated
  using (
    public.has_tenant_role(
      tenant_id,
      array['owner', 'admin']::public.tenant_role[]
    )
  )
  with check (
    public.has_tenant_role(
      tenant_id,
      array['owner', 'admin']::public.tenant_role[]
    )
  );

create policy meta_capi_event_mappings_delete_admin
  on public.meta_capi_event_mappings for delete to authenticated
  using (
    public.has_tenant_role(
      tenant_id,
      array['owner', 'admin']::public.tenant_role[]
    )
  );

create policy meta_capi_events_select_member
  on public.meta_capi_events for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- ---------------------------------------------------------------------------
-- Grants — access_token / dataset_id apenas via service_role.
-- ---------------------------------------------------------------------------

revoke all on table public.meta_capi_connections from authenticated, anon;
grant select (
  id,
  tenant_id,
  pixel_id,
  status,
  is_enabled,
  test_event_code,
  last_error,
  last_sent_at,
  connected_at,
  created_at,
  updated_at
) on table public.meta_capi_connections to authenticated;

revoke all on table public.meta_capi_event_mappings from anon;
grant select, insert, update, delete
  on public.meta_capi_event_mappings to authenticated;

revoke all on table public.meta_capi_events from anon;
grant select on public.meta_capi_events to authenticated;

grant all on table public.meta_capi_connections to service_role;
grant all on table public.meta_capi_event_mappings to service_role;
grant all on table public.meta_capi_events to service_role;
