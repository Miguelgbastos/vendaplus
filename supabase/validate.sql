-- Validação pós-migration do Venda+. Somente leitura; falha com exceção quando
-- a estrutura mínima não está presente ou uma tabela pública está sem RLS.

do $validation$
declare
  missing_tables text[];
  tables_without_rls text[];
begin
  select array_agg(required.name order by required.name)
  into missing_tables
  from unnest(array[
    'profiles', 'tenants', 'tenant_users', 'kommo_connections', 'kommo_users',
    'webhook_endpoints', 'raw_events', 'jobs', 'contacts', 'leads',
    'qualification_history', 'stage_history', 'app_installations',
    'tenant_invites', 'admin_audit_log', 'meta_capi_connections',
    'meta_capi_event_mappings', 'meta_capi_events'
  ]) as required(name)
  where to_regclass(format('public.%I', required.name)) is null;

  if missing_tables is not null then
    raise exception 'vendaplus_missing_tables: %', array_to_string(missing_tables, ', ');
  end if;

  select array_agg(c.relname order by c.relname)
  into tables_without_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity;

  if tables_without_rls is not null then
    raise exception 'vendaplus_tables_without_rls: %', array_to_string(tables_without_rls, ', ');
  end if;

  if to_regprocedure('public.sync_kommo_lead_state(uuid,text,jsonb,jsonb,qualification_stage[],qualification_stage,boolean,text,text,text)') is null then
    raise exception 'vendaplus_missing_function: sync_kommo_lead_state';
  end if;

  if to_regprocedure('public.dashboard_stage_counts(uuid,timestamp with time zone,timestamp with time zone,text,text,text,text,qualification_stage)') is null then
    raise exception 'vendaplus_missing_function: dashboard_stage_counts';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.qualification_history'::regclass
      and tgname = 'qualification_history_enqueue_meta_capi'
      and not tgisinternal
  ) then
    raise exception 'vendaplus_missing_trigger: qualification_history_enqueue_meta_capi';
  end if;
end;
$validation$;

select
  'vendaplus_database_ready' as status,
  count(*) filter (where relrowsecurity) as public_tables_with_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p');
