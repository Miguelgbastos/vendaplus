-- Run after migrations with:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/gwe_ingestion.sql

begin;

create temporary table gwe_test_ids (
  tenant_a uuid,
  tenant_b uuid,
  connection_a uuid,
  connection_b uuid,
  endpoint_a uuid,
  endpoint_b uuid
) on commit drop;

with tenants as (
  insert into public.tenants (name, slug)
  values ('GWE SQL Test A', 'gwe-sql-test-a'), ('GWE SQL Test B', 'gwe-sql-test-b')
  returning id, slug
), connections as (
  insert into public.crm_connections (tenant_id, provider, name)
  select id, 'generic', 'GWE SQL test ' || slug
  from tenants
  returning id, tenant_id
), endpoints as (
  insert into public.webhook_endpoints (tenant_id, token, connection_id)
  select tenant_id, 'gwe-sql-test-' || id::text, id
  from connections
  returning tenant_id, connection_id, endpoint_public_id
)
insert into gwe_test_ids
select
  (select id from tenants where slug = 'gwe-sql-test-a'),
  (select id from tenants where slug = 'gwe-sql-test-b'),
  (select id from connections where tenant_id = (select id from tenants where slug = 'gwe-sql-test-a')),
  (select id from connections where tenant_id = (select id from tenants where slug = 'gwe-sql-test-b')),
  (select endpoint_public_id from endpoints where tenant_id = (select id from tenants where slug = 'gwe-sql-test-a')),
  (select endpoint_public_id from endpoints where tenant_id = (select id from tenants where slug = 'gwe-sql-test-b'));

do $test$
declare
  ids record;
  result record;
  raw_count integer;
  processing_count integer;
  outbox_count integer;
begin
  select * into ids from gwe_test_ids;

  select * into result from public.ingest_crm_webhook_event(
    ids.endpoint_a, 'evt-sql-1', 'lead.snapshot',
    '{"event":"one"}'::jsonb, 'hash-a', '{}'::jsonb, now()
  );
  if result.status <> 'accepted' then
    raise exception 'expected accepted, got %', result.status;
  end if;

  select count(*) into raw_count
  from public.raw_events
  where connection_id = ids.connection_a and external_event_id = 'evt-sql-1';
  select count(*) into processing_count
  from public.event_processing ep
  join public.raw_events re on re.id = ep.raw_event_id
  where re.connection_id = ids.connection_a and re.external_event_id = 'evt-sql-1';
  select count(*) into outbox_count
  from public.processing_outbox po
  join public.raw_events re on re.id = po.raw_event_id
  where re.connection_id = ids.connection_a and re.external_event_id = 'evt-sql-1';
  if raw_count <> 1 or processing_count <> 1 or outbox_count <> 1 then
    raise exception 'atomic row counts wrong: %/%/%', raw_count, processing_count, outbox_count;
  end if;

  select * into result from public.ingest_crm_webhook_event(
    ids.endpoint_a, 'evt-sql-1', 'lead.snapshot',
    '{"event":"one"}'::jsonb, 'hash-a', '{}'::jsonb, now()
  );
  if result.status <> 'already_received' then
    raise exception 'expected already_received, got %', result.status;
  end if;

  select * into result from public.ingest_crm_webhook_event(
    ids.endpoint_a, 'evt-sql-1', 'lead.snapshot',
    '{"event":"different"}'::jsonb, 'hash-b', '{}'::jsonb, now()
  );
  if result.status <> 'event_id_collision' then
    raise exception 'expected event_id_collision, got %', result.status;
  end if;

  select * into result from public.ingest_crm_webhook_event(
    ids.endpoint_b, 'evt-sql-1', 'lead.snapshot',
    '{"event":"other-connection"}'::jsonb, 'hash-c', '{}'::jsonb, now()
  );
  if result.status <> 'accepted' then
    raise exception 'expected cross-connection accepted, got %', result.status;
  end if;
end
$test$;

delete from public.tenants
where slug in ('gwe-sql-test-a', 'gwe-sql-test-b');

commit;
