-- Remove somente registros identificados como demonstração na empresa alvo.
-- Históricos relacionados são removidos por ON DELETE CASCADE.

do $guard$
begin
  if not exists (select 1 from public.tenants where slug = '__DEMO_TENANT_SLUG__') then
    raise exception 'demo_tenant_not_found';
  end if;
end;
$guard$;

delete from public.leads
where tenant_id = (select id from public.tenants where slug = '__DEMO_TENANT_SLUG__')
  and raw ->> 'demo' = 'true';

delete from public.contacts
where tenant_id = (select id from public.tenants where slug = '__DEMO_TENANT_SLUG__')
  and raw ->> 'demo' = 'true';

select 'vendaplus_demo_removed' as status;
