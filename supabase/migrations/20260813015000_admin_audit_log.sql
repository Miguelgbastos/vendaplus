-- Administrative audit trail (service_role / SECURITY DEFINER writes).

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete set null,
  actor_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_log_tenant_created_idx
  on public.admin_audit_log (tenant_id, created_at desc);

alter table public.admin_audit_log enable row level security;

create policy admin_audit_log_select_admin
  on public.admin_audit_log for select to authenticated
  using (
    tenant_id is not null
    and public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
  );

revoke all on table public.admin_audit_log from authenticated, anon;
grant select on table public.admin_audit_log to authenticated;
grant all on table public.admin_audit_log to service_role;

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
begin
  insert into public.admin_audit_log (
    tenant_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_tenant_id, v_uid, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.write_admin_audit(uuid, text, text, text, jsonb)
  from public, anon;
grant execute on function public.write_admin_audit(uuid, text, text, text, jsonb)
  to authenticated, service_role;
