begin;

do $$
declare
  v_tenant uuid := gen_random_uuid();
  v_connection uuid := gen_random_uuid();
  v_other_connection uuid := gen_random_uuid();
  v_lead uuid := gen_random_uuid();
  v_other_lead uuid := gen_random_uuid();
  v_source_event text := 'shadow-' || gen_random_uuid()::text;
begin
  insert into public.tenants (id, name, slug)
  values (v_tenant, 'GWE shadow test', 'gwe-shadow-' || substr(v_tenant::text, 1, 8));

  insert into public.crm_connections (id, tenant_id, provider, name)
  values (v_connection, v_tenant, 'gwe', 'Shadow test');
  insert into public.crm_connections (id, tenant_id, provider, name)
  values (v_other_connection, v_tenant, 'gwe', 'Other shadow test');

  insert into public.leads (
    id, tenant_id, connection_id, external_lead_id, name, price,
    utm_source, raw
  ) values (
    v_lead, v_tenant, v_connection, 'shadow-lead', 'Shadow lead', 125,
    'google', '{}'::jsonb
  );
  insert into public.leads (
    id, tenant_id, connection_id, external_lead_id, name, price, raw
  ) values (
    v_other_lead, v_tenant, v_other_connection, 'shadow-lead', 'Other shadow lead',
    125, '{}'::jsonb
  );

  insert into public.qualification_history (
    tenant_id, lead_id, connection_id, source_event_id,
    to_qualification, source, metadata
  ) values (
    v_tenant, v_lead, v_connection, v_source_event,
    'mql', 'gwe', '{}'::jsonb
  ), (
    v_tenant, v_lead, v_connection, v_source_event,
    'sal', 'gwe', '{}'::jsonb
  ), (
    v_tenant, v_lead, v_connection, v_source_event,
    'sql', 'gwe', '{}'::jsonb
  );

  if (select count(*) from public.domain_events
      where tenant_id = v_tenant and source_event_id = v_source_event) <> 3 then
    raise exception 'expected three domain events';
  end if;

  if (select count(*) from public.integration_outbox
      where tenant_id = v_tenant and status = 'shadow') <> 3 then
    raise exception 'expected three shadow outbox events';
  end if;

  if exists (
    select 1
    from public.integration_outbox
    where tenant_id = v_tenant
      and (
        status <> 'shadow'
        or payload->>'source_event_id' <> v_source_event
        or payload->>'currency' <> 'BRL'
        or payload->>'lead_id' <> v_lead::text
        or payload->>'event_id' not like '%:lead.lifecycle.%'
      )
  ) then
    raise exception 'shadow payload is not comparable or is not shadow-only';
  end if;

  if (select count(*) from public.integration_outbox
      where tenant_id = v_tenant
        and event_key like '%:lead.lifecycle.%:meta') <> 3 then
    raise exception 'shadow event keys are not distinct';
  end if;

  insert into public.qualification_history (
    tenant_id, lead_id, connection_id, source_event_id,
    to_qualification, source, metadata
  ) values (
    v_tenant, v_other_lead, v_other_connection, v_source_event,
    'sql', 'gwe', '{}'::jsonb
  );

  if (select count(*) from public.domain_events
      where tenant_id = v_tenant and source_event_id = v_source_event) <> 4
     or (select count(*) from public.integration_outbox
         where tenant_id = v_tenant
           and payload->>'source_event_id' = v_source_event) <> 4 then
    raise exception 'same source event id collided across connections';
  end if;

  insert into public.qualification_history (
    tenant_id, lead_id, connection_id, source_event_id,
    to_qualification, source, metadata
  ) values (
    v_tenant, v_lead, v_connection, 'loss-' || v_source_event,
    'perda', 'gwe', '{}'::jsonb
  ), (
    v_tenant, v_lead, v_connection, 'win-' || v_source_event,
    'venda', 'gwe', '{}'::jsonb
  );

  if (select count(*) from public.domain_events
      where tenant_id = v_tenant) <> 6 then
    raise exception 'loss and sale milestones were not both recorded';
  end if;

  insert into public.qualification_history (
    tenant_id, lead_id, connection_id, source_event_id,
    to_qualification, source, metadata
  ) values (
    v_tenant, v_lead, v_connection, 'kommo-replay-' || v_source_event,
    'venda', 'kommo', '{}'::jsonb
  );

  if (select count(*) from public.integration_outbox
      where tenant_id = v_tenant) <> 6 then
    raise exception 'non-GWE history created a shadow event';
  end if;
end;
$$;

rollback;
