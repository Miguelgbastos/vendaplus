-- Harden SECURITY DEFINER grants and FORCE RLS on new public tables.
-- Created via: npx supabase migration new harden_security_definer_and_invite_failures

-- ---------------------------------------------------------------------------
-- FORCE RLS on new public tables (defense in depth)
-- ---------------------------------------------------------------------------
alter table public.tenant_invites force row level security;
alter table public.admin_audit_log force row level security;

-- ---------------------------------------------------------------------------
-- write_admin_audit: require active admin/owner membership when called as user.
-- service_role may write without auth.uid() (server jobs / backfill).
-- ---------------------------------------------------------------------------
create or replace function public.write_admin_audit(
  p_tenant_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_uid uuid := (select auth.uid());
  v_role text := coalesce((select auth.role()), '');
begin
  if p_tenant_id is null or btrim(coalesce(p_action, '')) = '' or btrim(coalesce(p_entity_type, '')) = '' then
    raise exception 'invalid_audit_payload' using errcode = '22023';
  end if;

  if v_role = 'service_role' then
    null; -- server-side writes allowed
  elsif v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  elsif not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin']::public.tenant_role[]
  ) then
    raise exception 'insufficient_permission' using errcode = '42501';
  end if;

  insert into public.admin_audit_log (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_tenant_id,
    v_uid,
    p_action,
    p_entity_type,
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.write_admin_audit(uuid, text, text, text, jsonb)
  from public, anon;
grant execute on function public.write_admin_audit(uuid, text, text, text, jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- accept_tenant_invite: never escalate an existing membership via invite role
-- ---------------------------------------------------------------------------
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
  v_existing_role public.tenant_role;
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

  select role into v_existing_role
  from public.tenant_users
  where tenant_id = v_invite.tenant_id and user_id = v_uid;

  if v_existing_role is null then
    insert into public.tenant_users (tenant_id, user_id, role)
    values (v_invite.tenant_id, v_uid, v_invite.role)
    returning id into v_membership_id;
  else
    -- Membership já existe: não sobrescrever papel via convite (anti-escalada).
    select id into v_membership_id
    from public.tenant_users
    where tenant_id = v_invite.tenant_id and user_id = v_uid;
  end if;

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
