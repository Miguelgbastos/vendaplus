-- Batch D — hardening: create_tenant_with_owner nunca eleva o papel de uma linha
-- existente em tenant_users. Antes o upsert fazia `do update set role='owner'`,
-- o que (se as invariantes mudassem) permitiria self-escalation para owner.
-- O caminho de reaquisição segue restrito ao criador original de um tenant órfão
-- (created_by = auth.uid() e sem nenhum membro).

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

  -- Nunca eleva o papel de uma linha existente (evita self-escalation para owner).
  insert into public.tenant_users (tenant_id, user_id, role)
  values (v_tenant_id, v_user_id, 'owner')
  on conflict (tenant_id, user_id) do nothing;

  return v_tenant_id;
end;
$$;

revoke all on function public.create_tenant_with_owner(text, text) from public;
revoke all on function public.create_tenant_with_owner(text, text) from anon;
revoke execute on function public.create_tenant_with_owner(text, text) from service_role;
grant execute on function public.create_tenant_with_owner(text, text) to authenticated;
