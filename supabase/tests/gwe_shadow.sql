begin;

do $$
declare
  v_tenant uuid := gen_random_uuid();
  v_connection uuid := gen_random_uuid();
  v_lead uuid := gen_random_uuid();
  v_source_event text := 'shadow-' || gen_random_uuid()::text;
begin
  insert into public.tenants (id, name, slug)
  values (v_tenant, 'GWE shadow test', 'gwe-shadow-' || substr(v_tenant::text, 1, 8));

  insert into public.crm_connections (id, tenant_id, provider, name)
  values (v_connection, v_tenant, 'gwe', 'Shadow test');

  insert into public.leads (
    id, tenant_id, connection_id, external_lead_id, name, price,
    utm_source, raw
  ) values (
    v_lead, v_tenant, v_connection, 'shadow-lead', 'Shadow lead', 125,
    'google', '{}'::jsonb
  );

  insert into public.qualification_history (
    tenant_id, lead_id, connection_id, source_event_id,
    to_qualification, source, metadata
  ) values (
    v_tenant, v_lead, v_connection, v_source_event,
    'sql', 'gwe', '{}'::jsonb
  );

  if (select count(*) from public.domain_events
      where tenant_id = v_tenant and source_event_id = v_source_event) <> 1 then
    raise exception 'expected one domain event';
  end if;

  if (select count(*) from public.integration_outbox
      where tenant_id = v_tenant and status = 'shadow') <> 1 then
    raise exception 'expected one shadow outbox event';
  end if;

  if (select payload->>'event_id' from public.integration_outbox
      where tenant_id = v_tenant) <> v_source_event then
    raise exception 'shadow event id mismatch';
  end if;

  if (select count(*) from public.integration_outbox
      where tenant_id = v_tenant) <> 1 then
    raise exception 'shadow event was duplicated';
  end if;
end;
$$;

rollback;
