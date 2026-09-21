-- GWE v1 ingestion foundation.
-- Additive only: legacy Kommo ingestion and Meta CAPI trigger remain unchanged.

create table public.crm_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  provider text not null,
  name text not null,
  schema_version integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_connections_provider_check
    check (provider in ('gwe', 'hubspot', 'pipedrive', 'rd_station', 'kommo', 'generic'))
);

create index crm_connections_tenant_idx
  on public.crm_connections (tenant_id, created_at desc);

create trigger crm_connections_set_updated_at
  before update on public.crm_connections
  for each row execute function private.set_updated_at();

alter table public.webhook_endpoints
  add column if not exists connection_id uuid
    references public.crm_connections (id) on delete cascade,
  add column if not exists endpoint_public_id uuid
    default gen_random_uuid();

create unique index webhook_endpoints_endpoint_public_id_unique
  on public.webhook_endpoints (endpoint_public_id)
  where endpoint_public_id is not null;

create index webhook_endpoints_connection_idx
  on public.webhook_endpoints (connection_id)
  where connection_id is not null;

create table public.webhook_signing_keys (
  id uuid primary key default gen_random_uuid(),
  webhook_endpoint_id uuid not null references public.webhook_endpoints (id) on delete cascade,
  key_id text not null,
  encrypted_secret text not null,
  status text not null default 'active',
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  constraint webhook_signing_keys_status_check
    check (status in ('active', 'grace_period', 'expired', 'revoked')),
  constraint webhook_signing_keys_validity_check
    check (valid_until is null or valid_until >= valid_from),
  constraint webhook_signing_keys_revocation_check
    check (revoked_at is null or revoked_at >= created_at),
  constraint webhook_signing_keys_endpoint_key_unique
    unique (webhook_endpoint_id, key_id)
);

create unique index webhook_signing_keys_one_active_unique
  on public.webhook_signing_keys (webhook_endpoint_id)
  where status = 'active' and revoked_at is null;

create index webhook_signing_keys_active_idx
  on public.webhook_signing_keys (webhook_endpoint_id, status)
  where status in ('active', 'grace_period');

alter table public.raw_events
  add column if not exists connection_id uuid
    references public.crm_connections (id) on delete set null,
  add column if not exists external_event_id text,
  add column if not exists payload_hash text,
  add column if not exists occurred_at timestamptz;

create unique index raw_events_connection_event_unique
  on public.raw_events (connection_id, external_event_id)
  where connection_id is not null and external_event_id is not null;

create index raw_events_connection_received_idx
  on public.raw_events (connection_id, received_at desc)
  where connection_id is not null;

create table public.event_processing (
  id uuid primary key default gen_random_uuid(),
  raw_event_id uuid not null references public.raw_events (id) on delete cascade,
  status text not null default 'received',
  attempts integer not null default 0,
  started_at timestamptz,
  last_attempt_at timestamptz,
  processed_at timestamptz,
  next_retry_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_processing_raw_event_unique unique (raw_event_id),
  constraint event_processing_status_check
    check (status in ('received', 'processing', 'retry_pending', 'processed', 'dead_letter'))
);

create index event_processing_pending_idx
  on public.event_processing (status, next_retry_at, created_at)
  where status in ('received', 'retry_pending');

create trigger event_processing_set_updated_at
  before update on public.event_processing
  for each row execute function private.set_updated_at();

create table public.processing_outbox (
  id uuid primary key default gen_random_uuid(),
  raw_event_id uuid not null references public.raw_events (id) on delete cascade,
  event_type text not null default 'crm_event_received',
  status text not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint processing_outbox_raw_event_type_unique
    unique (raw_event_id, event_type),
  constraint processing_outbox_status_check
    check (status in ('pending', 'processing', 'published', 'failed'))
);

create index processing_outbox_claim_idx
  on public.processing_outbox (status, available_at, created_at)
  where status in ('pending', 'failed');

create trigger processing_outbox_set_updated_at
  before update on public.processing_outbox
  for each row execute function private.set_updated_at();

alter table public.leads
  add column if not exists connection_id uuid
    references public.crm_connections (id) on delete set null,
  add column if not exists external_lead_id text,
  add column if not exists last_source_event_at timestamptz,
  add column if not exists last_source_sequence bigint,
  add column if not exists last_source_event_id text;

create index leads_connection_external_lookup_idx
  on public.leads (connection_id, external_lead_id)
  where connection_id is not null and external_lead_id is not null;

create unique index leads_connection_external_unique
  on public.leads (connection_id, external_lead_id)
  where connection_id is not null and external_lead_id is not null;

alter table public.qualification_history
  add column if not exists connection_id uuid
    references public.crm_connections (id) on delete set null,
  add column if not exists source_event_id text,
  add column if not exists domain_event_id text;

create unique index qualification_history_source_event_unique
  on public.qualification_history (connection_id, lead_id, to_qualification, source_event_id)
  where connection_id is not null and source_event_id is not null;

create unique index qualification_history_domain_event_unique
  on public.qualification_history (domain_event_id)
  where domain_event_id is not null;

create index qualification_history_connection_idx
  on public.qualification_history (connection_id, changed_at desc)
  where connection_id is not null;

alter table public.stage_history
  add column if not exists connection_id uuid
    references public.crm_connections (id) on delete set null,
  add column if not exists source_event_id text;

create index stage_history_connection_idx
  on public.stage_history (connection_id, changed_at desc)
  where connection_id is not null;

alter table public.crm_connections enable row level security;
alter table public.webhook_signing_keys enable row level security;
alter table public.event_processing enable row level security;
alter table public.processing_outbox enable row level security;

create policy crm_connections_select_member
  on public.crm_connections for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy crm_connections_insert_admin
  on public.crm_connections for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy crm_connections_update_admin
  on public.crm_connections for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy crm_connections_delete_admin
  on public.crm_connections for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy webhook_signing_keys_select_admin
  on public.webhook_signing_keys for select to authenticated
  using (
    exists (
      select 1
      from public.webhook_endpoints we
      join public.crm_connections cc on cc.id = we.connection_id
      where we.id = webhook_signing_keys.webhook_endpoint_id
        and public.has_tenant_role(cc.tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
  );

create policy event_processing_select_member
  on public.event_processing for select to authenticated
  using (
    exists (
      select 1
      from public.raw_events re
      where re.id = event_processing.raw_event_id
        and public.is_tenant_member(re.tenant_id)
    )
  );

create policy processing_outbox_select_admin
  on public.processing_outbox for select to authenticated
  using (
    exists (
      select 1
      from public.raw_events re
      where re.id = processing_outbox.raw_event_id
        and public.has_tenant_role(re.tenant_id, array['owner', 'admin']::public.tenant_role[])
    )
  );

revoke all on table public.crm_connections from anon, authenticated;
grant select on public.crm_connections to authenticated;
grant insert, update, delete on public.crm_connections to authenticated;
revoke all on table public.webhook_signing_keys from anon, authenticated;
grant select on public.webhook_signing_keys to authenticated;
revoke all on table public.event_processing from anon, authenticated;
grant select on public.event_processing to authenticated;
revoke all on table public.processing_outbox from anon, authenticated;
grant select on public.processing_outbox to authenticated;
grant all on all tables in schema public to service_role;

create or replace function public.ingest_crm_webhook_event(
  p_endpoint_public_id uuid,
  p_external_event_id text,
  p_event_type text,
  p_payload jsonb,
  p_payload_hash text,
  p_safe_headers jsonb,
  p_occurred_at timestamptz
)
returns table (
  status text,
  raw_event_id uuid,
  connection_id uuid,
  tenant_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_endpoint public.webhook_endpoints%rowtype;
  v_existing public.raw_events%rowtype;
  v_connection public.crm_connections%rowtype;
  v_raw_id uuid;
begin
  if p_external_event_id is null or btrim(p_external_event_id) = '' then
    raise exception 'external_event_id_required' using errcode = '22023';
  end if;
  if p_payload_hash is null or btrim(p_payload_hash) = '' then
    raise exception 'payload_hash_required' using errcode = '22023';
  end if;

  select we.*
    into v_endpoint
  from public.webhook_endpoints we
  where we.endpoint_public_id = p_endpoint_public_id
    and we.is_active
  for share;

  if not found then
    raise exception 'webhook_endpoint_not_found' using errcode = 'P0001';
  end if;

  if v_endpoint.connection_id is null then
    raise exception 'webhook_endpoint_not_configured' using errcode = 'P0001';
  end if;

  select cc.*
    into v_connection
  from public.crm_connections cc
  where cc.id = v_endpoint.connection_id
    and cc.is_active
  for share;

  if not found then
    raise exception 'crm_connection_inactive' using errcode = 'P0001';
  end if;

  insert into public.raw_events (
    tenant_id,
    webhook_endpoint_id,
    connection_id,
    provider,
    event_type,
    idempotency_key,
    external_event_id,
    payload,
    payload_hash,
    headers,
    occurred_at
  ) values (
    v_connection.tenant_id,
    v_endpoint.id,
    v_connection.id,
    v_connection.provider,
    p_event_type,
    p_external_event_id,
    p_external_event_id,
    p_payload,
    p_payload_hash,
    p_safe_headers,
    p_occurred_at
  )
  on conflict do nothing
  returning id into v_raw_id;

  if v_raw_id is null then
    select re.*
      into v_existing
    from public.raw_events re
    where re.connection_id = v_connection.id
      and re.external_event_id = p_external_event_id
    for update;

    if not found then
      raise exception 'raw_event_conflict_unresolved' using errcode = 'P0001';
    end if;

    if v_existing.payload_hash = p_payload_hash then
      return query select
        'already_received'::text,
        v_existing.id,
        v_connection.id,
        v_connection.tenant_id;
      return;
    end if;

    return query select
      'event_id_collision'::text,
      v_existing.id,
      v_connection.id,
      v_connection.tenant_id;
    return;
  end if;

  insert into public.event_processing (raw_event_id)
  values (v_raw_id);

  insert into public.processing_outbox (raw_event_id)
  values (v_raw_id);

  return query select
    'accepted'::text,
    v_raw_id,
    v_connection.id,
    v_connection.tenant_id;
end;
$$;

revoke all on function public.ingest_crm_webhook_event(
  uuid, text, text, jsonb, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.ingest_crm_webhook_event(
  uuid, text, text, jsonb, text, jsonb, timestamptz
) to service_role;
