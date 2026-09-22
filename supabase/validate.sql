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
    'meta_capi_event_mappings', 'meta_capi_events', 'crm_connections',
    'webhook_signing_keys', 'event_processing', 'processing_outbox',
    'domain_events', 'integration_outbox', 'meta_shadow_comparisons',
    'meta_shadow_parity_summary', 'meta_shadow_parity_totals'
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

  if to_regprocedure('public.ingest_crm_webhook_event(uuid,text,text,jsonb,text,jsonb,timestamp with time zone)') is null then
    raise exception 'vendaplus_missing_function: ingest_crm_webhook_event';
  end if;
  if to_regprocedure('public.create_gwe_connection(uuid,text,text,integer,text,uuid,text,text,uuid)') is null then
    raise exception 'vendaplus_missing_function: create_gwe_connection';
  end if;
  if to_regprocedure('public.rotate_gwe_webhook_signing_key(uuid,uuid,text,text,uuid)') is null then
    raise exception 'vendaplus_missing_function: rotate_gwe_webhook_signing_key';
  end if;

  if to_regprocedure('public.claim_processing_outbox(integer,text,integer)') is null then
    raise exception 'vendaplus_missing_function: claim_processing_outbox';
  end if;

  if to_regprocedure('public.reconcile_crm_lead_snapshot(uuid,jsonb)') is null then
    raise exception 'vendaplus_missing_function: reconcile_crm_lead_snapshot';
  end if;

  if to_regprocedure('public.fail_processing_outbox(uuid,text,text,integer)') is null then
    raise exception 'vendaplus_missing_function: fail_processing_outbox';
  end if;

  if to_regprocedure('public.compare_meta_shadow_event(uuid)') is null then
    raise exception 'vendaplus_missing_function: compare_meta_shadow_event';
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

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'raw_events_connection_event_unique'
  ) then
    raise exception 'vendaplus_missing_index: raw_events_connection_event_unique';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'leads_connection_external_unique'
  ) then
    raise exception 'vendaplus_missing_index: leads_connection_external_unique';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'webhook_signing_keys_one_active_unique'
  ) then
    raise exception 'vendaplus_missing_index: webhook_signing_keys_one_active_unique';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'stage_history_gwe_source_event_unique'
  ) then
    raise exception 'vendaplus_missing_index: stage_history_gwe_source_event_unique';
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
