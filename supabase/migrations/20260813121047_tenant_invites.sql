-- Tenant invite system with pending/accepted/cancelled/expired states.

create type public.tenant_invite_status as enum (
  'pending',
  'accepted',
  'cancelled',
  'expired'
);

create table public.tenant_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null,
  role public.tenant_role not null,
  status public.tenant_invite_status not null default 'pending',
  token_hash text not null,
  invited_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  cancelled_at timestamptz,
  last_sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_invites_email_nonempty check (btrim(email) <> ''),
  constraint tenant_invites_token_hash_unique unique (token_hash)
);

create index tenant_invites_tenant_status_idx
  on public.tenant_invites (tenant_id, status, created_at desc);

create unique index tenant_invites_pending_tenant_email_unique
  on public.tenant_invites (tenant_id, lower(trim(email)))
  where status = 'pending';

create trigger tenant_invites_set_updated_at
  before update on public.tenant_invites
  for each row execute function private.set_updated_at();

alter table public.tenant_invites enable row level security;

create policy tenant_invites_select_admin
  on public.tenant_invites for select to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

-- Mutations go through SECURITY DEFINER RPCs / service_role only.
revoke all on table public.tenant_invites from authenticated, anon;
grant select on table public.tenant_invites to authenticated;
grant all on table public.tenant_invites to service_role;

create or replace function public.accept_tenant_invite(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.tenant_invites%rowtype;
  v_uid uuid := (select auth.uid());
  v_email text;
  v_membership_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  select * into v_invite
  from public.tenant_invites
  where token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;

  if v_invite.status = 'cancelled' then
    raise exception 'invite_cancelled' using errcode = '22023';
  end if;

  if v_invite.status = 'accepted' then
    raise exception 'invite_already_accepted' using errcode = '22023';
  end if;

  if v_invite.expires_at <= now() or v_invite.status = 'expired' then
    update public.tenant_invites
    set status = 'expired', updated_at = now()
    where id = v_invite.id and status = 'pending';
    raise exception 'invite_expired' using errcode = '22023';
  end if;

  if lower(trim(v_invite.email)) <> v_email then
    raise exception 'invite_email_mismatch' using errcode = '42501';
  end if;

  perform 1 from public.tenants where id = v_invite.tenant_id and is_active;
  if not found then
    raise exception 'company_not_found' using errcode = 'P0002';
  end if;

  insert into public.profiles (id, email)
  values (v_uid, (select email from auth.users where id = v_uid))
  on conflict (id) do update
    set email = excluded.email, updated_at = now();

  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_invite.tenant_id, v_uid, v_invite.role)
  on conflict (tenant_id, user_id) do update
    set role = excluded.role, updated_at = now()
  returning id into v_membership_id;

  update public.tenant_invites
  set
    status = 'accepted',
    accepted_at = now(),
    accepted_by = v_uid,
    updated_at = now()
  where id = v_invite.id;

  return v_membership_id;
end;
$$;

revoke all on function public.accept_tenant_invite(text) from public, anon;
grant execute on function public.accept_tenant_invite(text) to authenticated;

-- Lookup for invite-or-add (service_role only — never expose to clients).
create or replace function public.find_auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;
$$;

revoke all on function public.find_auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.find_auth_user_id_by_email(text) to service_role;

create or replace function public.list_company_member_profiles(p_tenant_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  role public.tenant_role,
  email text,
  full_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_tenant_member(p_tenant_id) then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;

  return query
  select
    tu.id as membership_id,
    tu.user_id,
    tu.role,
    p.email,
    p.full_name
  from public.tenant_users tu
  left join public.profiles p on p.id = tu.user_id
  where tu.tenant_id = p_tenant_id
  order by tu.created_at asc;
end;
$$;

revoke all on function public.list_company_member_profiles(uuid) from public, anon;
grant execute on function public.list_company_member_profiles(uuid) to authenticated;
