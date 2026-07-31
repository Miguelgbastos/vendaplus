-- Per-tenant Kommo private integration credentials
-- Apply locally / via your process. Do not assume this file was applied remotely.

alter table public.kommo_connections
  add column if not exists integration_id text,
  add column if not exists client_secret_encrypted text;

comment on column public.kommo_connections.integration_id is
  'Kommo private integration client_id (Integration ID). Readable only via service_role.';
comment on column public.kommo_connections.client_secret_encrypted is
  'AES-GCM encrypted Kommo private integration secret. Readable only via service_role.';

-- Reafirma privilégios por coluna: authenticated NÃO vê secrets/tokens/integration_id
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

-- service_role mantém acesso completo (incluindo colunas sensíveis)
grant all on table public.kommo_connections to service_role;
