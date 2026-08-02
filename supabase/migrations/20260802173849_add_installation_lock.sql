-- One-time installation state. Internal tenant names stay unchanged to avoid a
-- destructive schema rename; the product domain calls them "empresas".
create table public.app_installations (
  singleton boolean primary key default true check (singleton),
  installed_at timestamptz not null default now(),
  installed_by uuid not null references auth.users (id) on delete restrict,
  first_tenant_id uuid not null references public.tenants (id) on delete restrict
);

alter table public.app_installations enable row level security;
revoke all on table public.app_installations from public, anon, authenticated;
grant select, insert on table public.app_installations to service_role;

-- Existing deployments are already installed. Backfill the lock without
-- changing any tenant/company data; fresh databases have no row and show /setup.
insert into public.app_installations (singleton, installed_by, first_tenant_id, installed_at)
select true, coalesce(t.created_by, owner_member.user_id), t.id, t.created_at
from public.tenants t
left join lateral (
  select tu.user_id
  from public.tenant_users tu
  where tu.tenant_id = t.id and tu.role = 'owner'
  order by tu.created_at asc
  limit 1
) owner_member on true
where coalesce(t.created_by, owner_member.user_id) is not null
order by t.created_at asc
limit 1
on conflict (singleton) do nothing;

create or replace function public.complete_app_installation(
  p_user_id uuid,
  p_company_name text,
  p_company_slug text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  perform pg_advisory_xact_lock(78392145);

  if exists (select 1 from public.app_installations where singleton) then
    raise exception 'installation_already_complete';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'installation_user_not_found';
  end if;
  if p_company_name is null or length(trim(p_company_name)) < 2 then
    raise exception 'invalid_company_name';
  end if;
  if p_company_slug is null or p_company_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'invalid_company_slug';
  end if;

  insert into public.tenants (name, slug, created_by)
  values (trim(p_company_name), p_company_slug, p_user_id)
  returning id into v_tenant_id;

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant_id, p_user_id, 'owner');

  insert into public.app_installations (singleton, installed_by, first_tenant_id)
  values (true, p_user_id, v_tenant_id);

  return v_tenant_id;
end;
$$;

revoke all on function public.complete_app_installation(uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_app_installation(uuid, text, text) to service_role;
