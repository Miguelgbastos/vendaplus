-- Atomic management operations for the GWE settings UI.

alter table public.webhook_endpoints
  drop constraint if exists webhook_endpoints_tenant_unique;

create or replace function public.create_gwe_connection(
  p_tenant_id uuid,
  p_provider text,
  p_name text,
  p_schema_version integer,
  p_endpoint_token text,
  p_endpoint_public_id uuid,
  p_key_id text,
  p_encrypted_secret text,
  p_created_by uuid
)
returns table (
  connection_id uuid,
  endpoint_id uuid,
  endpoint_public_id uuid,
  key_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_id uuid;
  v_endpoint_id uuid;
begin
  if p_tenant_id is null or p_name is null or btrim(p_name) = ''
    or p_endpoint_token is null or p_key_id is null
    or p_encrypted_secret is null or p_created_by is null then
    raise exception 'gwe_connection_input_required' using errcode = '22023';
  end if;
  if auth.uid() is null or auth.uid() <> p_created_by
    or not exists (
      select 1
      from public.tenant_users tu
      where tu.tenant_id = p_tenant_id
        and tu.user_id = auth.uid()
        and tu.role in ('owner', 'admin')
    ) then
    raise exception 'gwe_connection_forbidden' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text), hashtext('gwe_connection'));

  insert into public.crm_connections (tenant_id, provider, name, schema_version)
  values (p_tenant_id, p_provider, p_name, p_schema_version)
  returning id into v_connection_id;

  insert into public.webhook_endpoints (
    tenant_id, token, connection_id, endpoint_public_id, is_active
  )
  values (
    p_tenant_id, p_endpoint_token, v_connection_id, p_endpoint_public_id, true
  )
  returning id into v_endpoint_id;

  insert into public.webhook_signing_keys (
    webhook_endpoint_id, key_id, encrypted_secret, created_by
  )
  values (v_endpoint_id, p_key_id, p_encrypted_secret, p_created_by);

  return query select v_connection_id, v_endpoint_id, p_endpoint_public_id, p_key_id;
end;
$$;

create or replace function public.rotate_gwe_webhook_signing_key(
  p_tenant_id uuid,
  p_connection_id uuid,
  p_key_id text,
  p_encrypted_secret text,
  p_created_by uuid
)
returns table (
  endpoint_public_id uuid,
  grace_until timestamptz,
  key_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_endpoint public.webhook_endpoints%rowtype;
  v_grace_until timestamptz := now() + interval '24 hours';
begin
  if p_tenant_id is null or p_connection_id is null or p_key_id is null
    or p_encrypted_secret is null or p_created_by is null then
    raise exception 'gwe_key_rotation_input_required' using errcode = '22023';
  end if;
  if auth.uid() is null or auth.uid() <> p_created_by
    or not exists (
      select 1
      from public.tenant_users tu
      where tu.tenant_id = p_tenant_id
        and tu.user_id = auth.uid()
        and tu.role in ('owner', 'admin')
    ) then
    raise exception 'gwe_key_rotation_forbidden' using errcode = '42501';
  end if;

  select we.*
    into v_endpoint
  from public.webhook_endpoints we
  where we.connection_id = p_connection_id
    and we.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'gwe_webhook_endpoint_not_found' using errcode = 'P0001';
  end if;

  update public.webhook_signing_keys
  set status = 'grace_period', valid_until = v_grace_until
  where webhook_endpoint_id = v_endpoint.id
    and status = 'active'
    and revoked_at is null;

  insert into public.webhook_signing_keys (
    webhook_endpoint_id, key_id, encrypted_secret, created_by
  )
  values (v_endpoint.id, p_key_id, p_encrypted_secret, p_created_by);

  return query select v_endpoint.endpoint_public_id, v_grace_until, p_key_id;
end;
$$;

revoke all on function public.create_gwe_connection(
  uuid, text, text, integer, text, uuid, text, text, uuid
) from public, anon;
grant execute on function public.create_gwe_connection(
  uuid, text, text, integer, text, uuid, text, text, uuid
) to authenticated, service_role;

revoke all on function public.rotate_gwe_webhook_signing_key(
  uuid, uuid, text, text, uuid
) from public, anon;
grant execute on function public.rotate_gwe_webhook_signing_key(
  uuid, uuid, text, text, uuid
) to authenticated, service_role;
