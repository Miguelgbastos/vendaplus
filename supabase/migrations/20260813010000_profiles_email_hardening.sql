-- Harden profiles.email: authoritative sync from auth.users, column privileges,
-- and case-insensitive uniqueness after safe dedupe.

-- ---------------------------------------------------------------------------
-- Sync + dedupe before uniqueness
-- ---------------------------------------------------------------------------

-- Prefer auth.users as source of truth for email.
update public.profiles p
set
  email = u.email,
  updated_at = now()
from auth.users u
where u.id = p.id
  and p.email is distinct from u.email;

-- Clear duplicate emails keeping the oldest profile for each lower(email).
with ranked as (
  select
    id,
    row_number() over (
      partition by lower(trim(email))
      order by created_at asc, id asc
    ) as rn
  from public.profiles
  where email is not null
    and btrim(email) <> ''
)
update public.profiles p
set
  email = null,
  updated_at = now()
from ranked r
where p.id = r.id
  and r.rn > 1;

-- Profiles without a matching auth.users email stay as-is only if unique.

create unique index if not exists profiles_email_lower_unique
  on public.profiles (lower(trim(email)))
  where email is not null and btrim(email) <> '';

-- ---------------------------------------------------------------------------
-- Authoritative sync on auth.users insert/update
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

create or replace function private.handle_user_email_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
    set email = new.email, updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function private.handle_user_email_updated() from public;
grant execute on function private.handle_user_email_updated() to postgres, service_role;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function private.handle_user_email_updated();

-- Block client-side email mutation (full_name/avatar still updatable).
revoke update on table public.profiles from authenticated;
grant update (full_name, avatar_url, updated_at) on table public.profiles to authenticated;

-- manage_company_user: resolve identity only via auth.users (not spoofable profiles.email).
create or replace function public.manage_company_user(
  p_action text,
  p_tenant_id uuid,
  p_email text default null,
  p_membership_id uuid default null,
  p_role public.tenant_role default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.tenant_role;
  v_target public.tenant_users%rowtype;
  v_profile_id uuid;
  v_result uuid;
  v_owner_count integer;
  v_email text;
begin
  if p_action not in ('add', 'update', 'remove') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  perform 1 from public.tenants where id = p_tenant_id and is_active for update;
  if not found then raise exception 'company_not_found' using errcode = 'P0002'; end if;

  select role into v_actor_role
  from public.tenant_users
  where tenant_id = p_tenant_id and user_id = (select auth.uid());

  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;

  if p_action = 'add' then
    if p_role is null or (p_role = 'owner' and v_actor_role <> 'owner') then
      raise exception 'role_not_allowed' using errcode = '42501';
    end if;
    v_email := lower(trim(coalesce(p_email, '')));
    if v_email = '' then
      raise exception 'user_not_found' using errcode = 'P0002';
    end if;
    select u.id into v_profile_id
    from auth.users u
    where lower(u.email) = v_email
    limit 1;
    if v_profile_id is null then
      raise exception 'user_not_found' using errcode = 'P0002';
    end if;
    -- Keep profiles in sync for display.
    insert into public.profiles (id, email)
    values (v_profile_id, (select email from auth.users where id = v_profile_id))
    on conflict (id) do update
      set email = excluded.email, updated_at = now();
    insert into public.tenant_users (tenant_id, user_id, role)
    values (p_tenant_id, v_profile_id, p_role)
    returning id into v_result;
    return v_result;
  end if;

  select * into v_target from public.tenant_users
  where id = p_membership_id and tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'membership_not_found' using errcode = 'P0002'; end if;
  if v_actor_role = 'admin' and (v_target.role = 'owner' or p_role = 'owner') then
    raise exception 'owner_change_not_allowed' using errcode = '42501';
  end if;

  if v_target.role = 'owner' and (p_action = 'remove' or p_role <> 'owner') then
    select count(*) into v_owner_count from public.tenant_users
    where tenant_id = p_tenant_id and role = 'owner';
    if v_owner_count <= 1 then raise exception 'last_owner' using errcode = '23514'; end if;
  end if;

  if p_action = 'update' then
    if p_role is null then raise exception 'role_required' using errcode = '22023'; end if;
    update public.tenant_users set role = p_role where id = v_target.id returning id into v_result;
  else
    delete from public.tenant_users where id = v_target.id returning id into v_result;
  end if;
  return v_result;
end;
$$;
