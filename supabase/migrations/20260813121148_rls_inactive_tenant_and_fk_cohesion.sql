-- Deny inactive tenants in RLS helpers; tighten tenant insert; add FK cohesion.

create or replace function private.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_users tu
    join public.tenants t on t.id = tu.tenant_id
    where tu.tenant_id = p_tenant_id
      and tu.user_id = (select auth.uid())
      and t.is_active
  );
$$;

create or replace function private.has_tenant_role(
  p_tenant_id uuid,
  p_roles public.tenant_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_users tu
    join public.tenants t on t.id = tu.tenant_id
    where tu.tenant_id = p_tenant_id
      and tu.user_id = (select auth.uid())
      and tu.role = any (p_roles)
      and t.is_active
  );
$$;

drop policy if exists tenants_insert_authenticated on public.tenants;
create policy tenants_insert_authenticated
  on public.tenants for insert to authenticated
  with check (created_by = (select auth.uid()));

-- Repair incoherent references before composite FKs.
update public.leads l
set contact_id = null
where l.contact_id is not null
  and not exists (
    select 1
    from public.contacts c
    where c.id = l.contact_id
      and c.tenant_id = l.tenant_id
  );

delete from public.qualification_history qh
where not exists (
  select 1 from public.leads l
  where l.id = qh.lead_id and l.tenant_id = qh.tenant_id
);

delete from public.stage_history sh
where not exists (
  select 1 from public.leads l
  where l.id = sh.lead_id and l.tenant_id = sh.tenant_id
);

-- Composite uniqueness for FK cohesion (id already PK; add (id, tenant_id)).
alter table public.leads
  drop constraint if exists leads_id_tenant_unique;
alter table public.leads
  add constraint leads_id_tenant_unique unique (id, tenant_id);

alter table public.contacts
  drop constraint if exists contacts_id_tenant_unique;
alter table public.contacts
  add constraint contacts_id_tenant_unique unique (id, tenant_id);

-- Recreate child FKs with tenant cohesion where safe.
alter table public.leads
  drop constraint if exists leads_contact_id_fkey;
alter table public.leads
  drop constraint if exists leads_contact_tenant_fkey;
alter table public.leads
  add constraint leads_contact_tenant_fkey
  foreign key (contact_id, tenant_id)
  references public.contacts (id, tenant_id)
  on delete set null;

alter table public.qualification_history
  drop constraint if exists qualification_history_lead_id_fkey;
alter table public.qualification_history
  drop constraint if exists qualification_history_lead_tenant_fkey;
alter table public.qualification_history
  add constraint qualification_history_lead_tenant_fkey
  foreign key (lead_id, tenant_id)
  references public.leads (id, tenant_id)
  on delete cascade;

alter table public.stage_history
  drop constraint if exists stage_history_lead_id_fkey;
alter table public.stage_history
  drop constraint if exists stage_history_lead_tenant_fkey;
alter table public.stage_history
  add constraint stage_history_lead_tenant_fkey
  foreign key (lead_id, tenant_id)
  references public.leads (id, tenant_id)
  on delete cascade;

-- Soften destructive analyst deletes: only owner/admin may delete CRM rows.
drop policy if exists contacts_delete_analyst on public.contacts;
create policy contacts_delete_admin
  on public.contacts for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

drop policy if exists leads_delete_analyst on public.leads;
create policy leads_delete_admin
  on public.leads for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

drop policy if exists qualification_history_delete_analyst on public.qualification_history;
create policy qualification_history_delete_admin
  on public.qualification_history for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

drop policy if exists stage_history_delete_analyst on public.stage_history;
create policy stage_history_delete_admin
  on public.stage_history for delete to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));
