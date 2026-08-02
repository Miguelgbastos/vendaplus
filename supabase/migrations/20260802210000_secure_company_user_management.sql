-- Gestão atômica de acesso por empresa. Leituras continuam protegidas por RLS;
-- mutações passam exclusivamente por esta função para impedir escalada de papel.
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
begin
  if p_action not in ('add', 'update', 'remove') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  -- Serializa alterações da mesma empresa e torna a proteção do último owner atômica.
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
    select id into v_profile_id from public.profiles where lower(email) = lower(trim(p_email)) limit 1;
    if v_profile_id is null then raise exception 'user_not_found' using errcode = 'P0002'; end if;
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

revoke all on function public.manage_company_user(text, uuid, text, uuid, public.tenant_role) from public, anon;
grant execute on function public.manage_company_user(text, uuid, text, uuid, public.tenant_role) to authenticated;
