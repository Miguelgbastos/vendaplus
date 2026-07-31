-- Venda+ initial schema
-- Apply locally / via CLI. Do not run blindly against production without review.

create extension if not exists "pgcrypto";

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to postgres, service_role, authenticated;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.tenant_role as enum ('owner', 'admin', 'analyst', 'viewer');
create type public.job_status as enum ('pending', 'processing', 'completed', 'failed', 'dead');
create type public.qualification_stage as enum (
  'mql',
  'sal',
  'sql',
  'oportunidade',
  'negociacao',
  'venda',
  'perda'
);
create type public.kommo_connection_status as enum (
  'pending',
  'connected',
  'disconnected',
  'error'
);

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_email_idx on public.profiles (email);

-- ---------------------------------------------------------------------------
-- Tenants & membership
-- ---------------------------------------------------------------------------

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint tenants_slug_unique unique (slug)
);

create index tenants_created_by_idx on public.tenants (created_by);

create table public.tenant_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.tenant_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_users_tenant_user_unique unique (tenant_id, user_id)
);

create index tenant_users_user_id_idx on public.tenant_users (user_id);
create index tenant_users_tenant_id_idx on public.tenant_users (tenant_id);

-- ---------------------------------------------------------------------------
-- Kommo connection & webhooks
-- ---------------------------------------------------------------------------

create table public.kommo_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  subdomain text,
  account_id text,
  integration_id text,
  client_secret_encrypted text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  status public.kommo_connection_status not null default 'pending',
  last_error text,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kommo_connections_tenant_unique unique (tenant_id)
);

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  token text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhook_endpoints_token_unique unique (token),
  constraint webhook_endpoints_tenant_unique unique (tenant_id)
);

create index webhook_endpoints_token_idx on public.webhook_endpoints (token) where is_active;

-- OAuth state one-time (nunca armazena o state puro — só hash)
create table public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null,
  nonce text not null,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint oauth_states_hash_unique unique (state_hash)
);

create index oauth_states_lookup_idx
  on public.oauth_states (state_hash)
  where consumed_at is null;

create index oauth_states_tenant_id_idx on public.oauth_states (tenant_id);
create index oauth_states_user_id_idx on public.oauth_states (user_id);

create table public.field_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  entity text not null default 'lead',
  source_field text not null,
  target_field text not null,
  transform text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_mappings_unique unique (tenant_id, entity, source_field, target_field)
);

create index field_mappings_tenant_idx on public.field_mappings (tenant_id) where is_active;

-- ---------------------------------------------------------------------------
-- Ingestion queue
-- ---------------------------------------------------------------------------

create table public.raw_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  webhook_endpoint_id uuid references public.webhook_endpoints (id) on delete set null,
  provider text not null default 'kommo',
  event_type text,
  idempotency_key text not null,
  payload jsonb not null,
  headers jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint raw_events_idempotency_unique unique (tenant_id, provider, idempotency_key)
);

create index raw_events_tenant_received_idx on public.raw_events (tenant_id, received_at desc);
create index raw_events_unprocessed_idx on public.raw_events (tenant_id) where processed_at is null;
create index raw_events_webhook_endpoint_id_idx on public.raw_events (webhook_endpoint_id);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  raw_event_id uuid references public.raw_events (id) on delete set null,
  job_type text not null default 'process_kommo_event',
  status public.job_status not null default 'pending',
  priority int not null default 100,
  attempts int not null default 0,
  max_attempts int not null default 5,
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_claim_idx
  on public.jobs (status, available_at, priority, created_at)
  where status in ('pending', 'failed');

create index jobs_tenant_idx on public.jobs (tenant_id, created_at desc);

-- Um job por evento bruto + tipo (idempotência sob retry/concorrência)
create unique index jobs_raw_event_type_unique
  on public.jobs (raw_event_id, job_type)
  where raw_event_id is not null;

-- ---------------------------------------------------------------------------
-- CRM entities
-- ---------------------------------------------------------------------------

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kommo_contact_id text,
  name text,
  email text,
  phone text,
  company text,
  raw jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_tenant_kommo_unique unique (tenant_id, kommo_contact_id)
);

create index contacts_tenant_email_idx on public.contacts (tenant_id, email);
create index contacts_tenant_phone_idx on public.contacts (tenant_id, phone);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  kommo_lead_id text,
  name text,
  pipeline_id text,
  status_id text,
  status_name text,
  price numeric(14, 2),
  responsible_user_id text,
  qualification public.qualification_stage,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  custom_fields jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  closed_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_tenant_kommo_unique unique (tenant_id, kommo_lead_id)
);

create index leads_tenant_qualification_idx on public.leads (tenant_id, qualification);
create index leads_tenant_status_idx on public.leads (tenant_id, status_id);
create index leads_tenant_utm_source_idx on public.leads (tenant_id, utm_source);
create index leads_tenant_updated_idx on public.leads (tenant_id, updated_at desc);
create index leads_contact_id_idx on public.leads (contact_id);

create table public.qualification_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  from_qualification public.qualification_stage,
  to_qualification public.qualification_stage not null,
  source text not null default 'kommo',
  changed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index qualification_history_lead_idx
  on public.qualification_history (lead_id, changed_at desc);
create index qualification_history_tenant_idx
  on public.qualification_history (tenant_id, changed_at desc);

create table public.stage_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  from_pipeline_id text,
  from_status_id text,
  from_status_name text,
  to_pipeline_id text,
  to_status_id text,
  to_status_name text,
  source text not null default 'kommo',
  changed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index stage_history_lead_idx on public.stage_history (lead_id, changed_at desc);
create index stage_history_tenant_idx on public.stage_history (tenant_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;
grant execute on function private.set_updated_at() to postgres, service_role;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function private.set_updated_at();

create trigger tenant_users_set_updated_at
  before update on public.tenant_users
  for each row execute function private.set_updated_at();

create trigger kommo_connections_set_updated_at
  before update on public.kommo_connections
  for each row execute function private.set_updated_at();

create trigger webhook_endpoints_set_updated_at
  before update on public.webhook_endpoints
  for each row execute function private.set_updated_at();

create trigger field_mappings_set_updated_at
  before update on public.field_mappings
  for each row execute function private.set_updated_at();

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function private.set_updated_at();

create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function private.set_updated_at();

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auth profile bootstrap
-- ---------------------------------------------------------------------------

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        updated_at = now();
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;
grant execute on function private.handle_new_user() to postgres, service_role;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Membership helpers (private schema, fixed search_path)
-- ---------------------------------------------------------------------------

create or replace function private.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = p_tenant_id
      and tu.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_tenant_role(
  p_tenant_id uuid,
  p_roles public.tenant_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = p_tenant_id
      and tu.user_id = (select auth.uid())
      and tu.role = any (p_roles)
  );
$$;

revoke all on function private.is_tenant_member(uuid) from public;
revoke all on function private.has_tenant_role(uuid, public.tenant_role[]) from public;
grant execute on function private.is_tenant_member(uuid) to authenticated, service_role;
grant execute on function private.has_tenant_role(uuid, public.tenant_role[]) to authenticated, service_role;

-- Thin public wrappers for RLS readability (still security definer via private)
create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_tenant_member(p_tenant_id);
$$;

create or replace function public.has_tenant_role(
  p_tenant_id uuid,
  p_roles public.tenant_role[]
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.has_tenant_role(p_tenant_id, p_roles);
$$;

revoke all on function public.is_tenant_member(uuid) from public;
revoke all on function public.has_tenant_role(uuid, public.tenant_role[]) from public;
grant execute on function public.is_tenant_member(uuid) to authenticated, service_role;
grant execute on function public.has_tenant_role(uuid, public.tenant_role[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_tenant_with_owner (atomic_tenant_creation)
-- ---------------------------------------------------------------------------

create or replace function public.create_tenant_with_owner(
  p_name text,
  p_slug text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_tenant_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication_required';
  end if;

  if p_name is null or length(trim(p_name)) < 2 then
    raise exception 'invalid_tenant_name';
  end if;

  if p_slug is null or length(trim(p_slug)) = 0 or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'invalid_tenant_slug';
  end if;

  insert into public.tenants (name, slug, created_by)
  values (trim(p_name), p_slug, v_user_id)
  on conflict (slug) do nothing
  returning id into v_tenant_id;

  if v_tenant_id is null then
    select t.id
    into v_tenant_id
    from public.tenants t
    where t.slug = p_slug
      and t.created_by = v_user_id
      and not exists (
        select 1
        from public.tenant_users tu
        where tu.tenant_id = t.id
      )
    for update;

    if v_tenant_id is null then
      raise exception 'tenant_slug_unavailable';
    end if;
  end if;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant_id, v_user_id, 'owner')
  on conflict (tenant_id, user_id) do update
    set role = excluded.role,
        updated_at = now();

  return v_tenant_id;
end;
$$;

revoke all on function public.create_tenant_with_owner(text, text) from public;
revoke all on function public.create_tenant_with_owner(text, text) from anon;
revoke execute on function public.create_tenant_with_owner(text, text) from service_role;
grant execute on function public.create_tenant_with_owner(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- claim_jobs (FOR UPDATE SKIP LOCKED)
-- ---------------------------------------------------------------------------

create or replace function public.claim_jobs(
  p_limit int default 10,
  p_worker_id text default 'worker',
  p_job_types text[] default array['process_kommo_event']
)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 then
    p_limit := 10;
  end if;
  if p_limit > 100 then
    p_limit := 100;
  end if;

  return query
  with candidates as (
    select j.id
    from public.jobs j
    where j.status in ('pending', 'failed')
      and j.available_at <= now()
      and j.attempts < j.max_attempts
      and (p_job_types is null or j.job_type = any (p_job_types))
    order by j.priority asc, j.created_at asc
    for update of j skip locked
    limit p_limit
  ),
  updated as (
    update public.jobs j
    set
      status = 'processing',
      attempts = j.attempts + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      updated_at = now()
    from candidates c
    where j.id = c.id
    returning j.*
  )
  select * from updated;
end;
$$;

revoke all on function public.claim_jobs(int, text, text[]) from public;
revoke execute on function public.claim_jobs(integer, text, text[]) from anon, authenticated;
grant execute on function public.claim_jobs(integer, text, text[]) to service_role;

-- Consome state OAuth atomicamente (one-time). Retorna true se consumiu nesta chamada.
create or replace function public.consume_oauth_state(
  p_state_hash text,
  p_tenant_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.oauth_states s
  set consumed_at = now()
  where s.state_hash = p_state_hash
    and s.tenant_id = p_tenant_id
    and s.user_id = p_user_id
    and s.consumed_at is null
    and s.expires_at > now()
  returning s.id into v_id;

  return v_id is not null;
end;
$$;

revoke all on function public.consume_oauth_state(text, uuid, uuid) from public;
revoke execute on function public.consume_oauth_state(text, uuid, uuid) from anon, authenticated;
grant execute on function public.consume_oauth_state(text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_users enable row level security;
alter table public.kommo_connections enable row level security;
alter table public.webhook_endpoints enable row level security;
alter table public.oauth_states enable row level security;
alter table public.field_mappings enable row level security;
alter table public.raw_events enable row level security;
alter table public.jobs enable row level security;
alter table public.contacts enable row level security;
alter table public.leads enable row level security;
alter table public.qualification_history enable row level security;
alter table public.stage_history enable row level security;

-- profiles
create policy profiles_select_own
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- tenants
create policy tenants_select_member
  on public.tenants for select to authenticated
  using (
    public.is_tenant_member(id)
    or created_by = (select auth.uid())
  );

create policy tenants_insert_authenticated
  on public.tenants for insert to authenticated
  with check ((select auth.uid()) is not null);

create policy tenants_update_admin
  on public.tenants for update to authenticated
  using (public.has_tenant_role(id, array['owner', 'admin']::public.tenant_role[]))
  with check (public.has_tenant_role(id, array['owner', 'admin']::public.tenant_role[]));

-- tenant_users
create policy tenant_users_select_member
  on public.tenant_users for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    or user_id = (select auth.uid())
  );
create policy tenant_users_insert_admin
  on public.tenant_users for insert to authenticated
  with check (
    public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    or (
      user_id = (select auth.uid())
      and role = 'owner'
      and not exists (
        select 1 from public.tenant_users tu where tu.tenant_id = tenant_users.tenant_id
      )
    )
  );

create policy tenant_users_update_admin
  on public.tenant_users for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy tenant_users_delete_admin
  on public.tenant_users for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

-- kommo_connections: SELECT de metadados para membros; tokens só via service_role
create policy kommo_connections_select_member
  on public.kommo_connections for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- webhook_endpoints: token e metadados só para owner/admin (RLS); viewers sem linhas
create policy webhook_endpoints_select_admin
  on public.webhook_endpoints for select to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy webhook_endpoints_insert_admin
  on public.webhook_endpoints for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy webhook_endpoints_update_admin
  on public.webhook_endpoints for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy webhook_endpoints_delete_admin
  on public.webhook_endpoints for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

-- oauth_states: RLS on, sem policies para authenticated/anon (só service_role)

-- field_mappings
create policy field_mappings_select_member
  on public.field_mappings for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy field_mappings_insert_admin
  on public.field_mappings for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy field_mappings_update_admin
  on public.field_mappings for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy field_mappings_delete_admin
  on public.field_mappings for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

-- raw_events / jobs: members can read; writes via service_role only (no insert policies for authenticated)
create policy raw_events_select_member
  on public.raw_events for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy jobs_select_member
  on public.jobs for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- contacts / leads / histories
create policy contacts_select_member
  on public.contacts for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy contacts_insert_analyst
  on public.contacts for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin', 'analyst']::public.tenant_role[]));

create policy contacts_update_analyst
  on public.contacts for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'analyst']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin', 'analyst']::public.tenant_role[]));

create policy contacts_delete_analyst
  on public.contacts for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'analyst']::public.tenant_role[]));

create policy leads_select_member
  on public.leads for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy leads_insert_analyst
  on public.leads for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin', 'analyst']::public.tenant_role[]));

create policy leads_update_analyst
  on public.leads for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'analyst']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin', 'analyst']::public.tenant_role[]));

create policy leads_delete_analyst
  on public.leads for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'analyst']::public.tenant_role[]));

create policy qualification_history_select_member
  on public.qualification_history for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy qualification_history_insert_analyst
  on public.qualification_history for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin', 'analyst']::public.tenant_role[]));

create policy qualification_history_update_analyst
  on public.qualification_history for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'analyst']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin', 'analyst']::public.tenant_role[]));

create policy qualification_history_delete_analyst
  on public.qualification_history for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'analyst']::public.tenant_role[]));

create policy stage_history_select_member
  on public.stage_history for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy stage_history_insert_analyst
  on public.stage_history for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin', 'analyst']::public.tenant_role[]));

create policy stage_history_update_analyst
  on public.stage_history for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'analyst']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin', 'analyst']::public.tenant_role[]));

create policy stage_history_delete_analyst
  on public.stage_history for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin', 'analyst']::public.tenant_role[]));

-- Grants on tables
grant usage on schema public to anon, authenticated, service_role;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.tenants to authenticated;
grant select, insert, update, delete on public.tenant_users to authenticated;

-- kommo_connections: privilégio por coluna — secrets/tokens/integration_id só via service_role
revoke all on table public.kommo_connections from authenticated;
revoke all on table public.kommo_connections from anon;
grant select (
  id,
  tenant_id,
  subdomain,
  account_id,
  token_expires_at,
  scopes,
  status,
  last_error,
  connected_at,
  created_at,
  updated_at
) on table public.kommo_connections to authenticated;

-- webhook_endpoints: token só legível via SELECT quando RLS de owner/admin passar
revoke all on table public.webhook_endpoints from authenticated;
grant select (
  id,
  tenant_id,
  token,
  is_active,
  created_at,
  updated_at
) on table public.webhook_endpoints to authenticated;
grant insert (
  id,
  tenant_id,
  token,
  is_active,
  created_at,
  updated_at
) on table public.webhook_endpoints to authenticated;
grant update (
  token,
  is_active,
  updated_at
) on table public.webhook_endpoints to authenticated;
grant delete on table public.webhook_endpoints to authenticated;

-- oauth_states: nenhum privilégio para authenticated/anon
revoke all on table public.oauth_states from public;
revoke all on table public.oauth_states from anon, authenticated;

grant select, insert, update, delete on public.field_mappings to authenticated;
grant select on public.raw_events to authenticated;
grant select on public.jobs to authenticated;
grant select, insert, update, delete on public.contacts to authenticated;
grant select, insert, update, delete on public.leads to authenticated;
grant select, insert, update, delete on public.qualification_history to authenticated;
grant select, insert, update, delete on public.stage_history to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
