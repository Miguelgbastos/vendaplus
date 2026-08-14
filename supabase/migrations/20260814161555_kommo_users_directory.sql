-- Tenant-scoped projection of the Kommo user directory.
-- Kommo remains the source of truth; this table only provides stable labels
-- without adding an API request to every dashboard render.

create table public.kommo_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kommo_user_id text not null,
  name text not null,
  is_active boolean not null default true,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kommo_users_tenant_user_unique unique (tenant_id, kommo_user_id),
  constraint kommo_users_id_format check (kommo_user_id ~ '^[1-9][0-9]*$'),
  constraint kommo_users_name_not_blank check (btrim(name) <> '')
);

create index kommo_users_tenant_active_name_idx
  on public.kommo_users (tenant_id, is_active, name);

create trigger kommo_users_set_updated_at
  before update on public.kommo_users
  for each row execute function private.set_updated_at();

alter table public.kommo_users enable row level security;

create policy kommo_users_select_member
  on public.kommo_users for select to authenticated
  using (public.is_tenant_member(tenant_id));

revoke all on public.kommo_users from public, anon, authenticated;
grant select on public.kommo_users to authenticated;
grant all on public.kommo_users to service_role;
