-- Structural and transactional invariants for GWE webhook management.
-- Run after migrations with ON_ERROR_STOP=1.

begin;

do $test$
declare
  endpoint_count integer;
  active_key_count integer;
begin
  if to_regprocedure('public.create_gwe_connection(uuid,text,text,integer,text,uuid,text,text,uuid)') is null
    or to_regprocedure('public.rotate_gwe_webhook_signing_key(uuid,uuid,text,text,uuid)') is null then
    raise exception 'GWE webhook management RPCs are missing';
  end if;

  select count(*) into endpoint_count
  from pg_constraint
  where conrelid = 'public.webhook_endpoints'::regclass
    and conname = 'webhook_endpoints_tenant_unique';
  if endpoint_count <> 0 then
    raise exception 'legacy single-endpoint tenant constraint still exists';
  end if;

  select count(*) into active_key_count
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'webhook_signing_keys'
    and indexname = 'webhook_signing_keys_one_active_unique';
  if active_key_count <> 1 then
    raise exception 'active signing key uniqueness is not enforced';
  end if;

  if not exists (
    select 1
    from pg_proc p
    where p.oid = 'public.create_gwe_connection(uuid,text,text,integer,text,uuid,text,text,uuid)'::regprocedure
      and p.prosecdef
      and pg_get_functiondef(p.oid) like '%auth.uid()%'
      and pg_get_functiondef(p.oid) like '%tenant_users%'
  ) then
    raise exception 'create_gwe_connection must enforce auth membership internally';
  end if;

  if not exists (
    select 1
    from pg_proc p
    where p.oid = 'public.rotate_gwe_webhook_signing_key(uuid,uuid,text,text,uuid)'::regprocedure
      and p.prosecdef
      and pg_get_functiondef(p.oid) like '%auth.uid()%'
      and pg_get_functiondef(p.oid) like '%tenant_users%'
  ) then
    raise exception 'rotate_gwe_webhook_signing_key must enforce auth membership internally';
  end if;
end
$test$;

rollback;
