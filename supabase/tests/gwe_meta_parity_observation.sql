begin;

do $$
declare
  v_tenant uuid := gen_random_uuid();
  v_connection uuid := gen_random_uuid();
  v_lead uuid := gen_random_uuid();
  v_source_event text := 'parity-' || gen_random_uuid()::text;
  v_domain uuid;
begin
  insert into public.tenants (id, name, slug)
  values (v_tenant, 'GWE parity test', 'gwe-parity-' || substr(v_tenant::text, 1, 8));
  insert into public.crm_connections (id, tenant_id, provider, name)
  values (v_connection, v_tenant, 'gwe', 'Parity test');
  insert into public.leads (
    id, tenant_id, connection_id, external_lead_id, name, raw
  ) values (
    v_lead, v_tenant, v_connection, 'parity-lead', 'Parity lead', '{}'::jsonb
  );

  insert into public.domain_events (
    tenant_id, connection_id, lead_id, source_event_id, event_type,
    event_key, payload, occurred_at
  ) values (
    v_tenant, v_connection, v_lead, v_source_event, 'lead.lifecycle.sql_reached',
    v_connection::text || ':' || v_source_event || ':lead.lifecycle.sql',
    jsonb_build_object('qualification', 'sql'),
    now()
  );

  select id into v_domain
  from public.domain_events
  where tenant_id = v_tenant and source_event_id = v_source_event;

  insert into public.meta_shadow_comparisons (
    tenant_id, domain_event_id, result, shadow_payload, shadow_payload_hash
  )
  select
    v_tenant, id, 'matched',
    jsonb_build_object('qualification', 'sql'),
    md5(jsonb_build_object('qualification', 'sql')::text)
  from public.domain_events
  where tenant_id = v_tenant and source_event_id = v_source_event;

  insert into public.integration_outbox (
    tenant_id, domain_event_id, destination, event_type, event_key,
    payload
  ) values (
    v_tenant, v_domain, 'meta_capi', 'would_send_meta_event',
    v_source_event || ':meta',
    jsonb_build_object('qualification', 'sql')
  );

  if (select matched_events from public.meta_shadow_parity_totals
      where tenant_id = v_tenant and qualification = 'sql') <> 1 then
    raise exception 'matched denominator was not aggregated';
  end if;

  insert into public.domain_events (
    tenant_id, connection_id, lead_id, source_event_id, event_type,
    event_key, payload, occurred_at
  ) values (
    v_tenant, v_connection, v_lead, v_source_event || '-missing-shadow',
    'lead.lifecycle.sql_reached',
    v_connection::text || ':' || v_source_event || '-missing-shadow:lead.lifecycle.sql',
    jsonb_build_object('qualification', 'sql'),
    now()
  );

  if (select missing_shadow from public.meta_shadow_parity_totals
      where tenant_id = v_tenant and qualification = 'sql') <> 1 then
    raise exception 'missing shadow was not detected from expected events';
  end if;

  if (select expected_events from public.meta_shadow_parity_totals
      where tenant_id = v_tenant and qualification = 'sql') <> 2
     or (select comparable_events from public.meta_shadow_parity_totals
         where tenant_id = v_tenant and qualification = 'sql') <> 1 then
    raise exception 'expected/comparable denominators are incorrect';
  end if;

  if (select match_rate from public.meta_shadow_parity_totals
      where tenant_id = v_tenant and qualification = 'sql') <> 1.0000
     or (select coverage_rate from public.meta_shadow_parity_totals
         where tenant_id = v_tenant and qualification = 'sql') <> 0.5000 then
    raise exception 'match rate was not calculated';
  end if;

  insert into public.domain_events (
    tenant_id, connection_id, lead_id, source_event_id, event_type,
    event_key, payload, occurred_at
  ) values (
    v_tenant, v_connection, v_lead, v_source_event || '-not-compared',
    'lead.lifecycle.sql_reached',
    v_connection::text || ':' || v_source_event || '-not-compared:lead.lifecycle.sql',
    jsonb_build_object('qualification', 'sql'),
    now()
  ) returning id into v_domain;

  insert into public.integration_outbox (
    tenant_id, domain_event_id, destination, event_type, event_key, payload
  ) values (
    v_tenant, v_domain, 'meta_capi', 'would_send_meta_event',
    v_source_event || '-not-compared:meta',
    jsonb_build_object('qualification', 'sql')
  );

  if (select not_compared from public.meta_shadow_parity_totals
      where tenant_id = v_tenant and qualification = 'sql') <> 1
     or (select missing_shadow from public.meta_shadow_parity_totals
         where tenant_id = v_tenant and qualification = 'sql') <> 1
     or (select comparable_events from public.meta_shadow_parity_totals
         where tenant_id = v_tenant and qualification = 'sql') <> 1 then
    raise exception 'not_compared was not classified independently';
  end if;

  if (select match_rate from public.meta_shadow_parity_totals
      where tenant_id = v_tenant and qualification = 'sql') <> 1.0000
     or (select coverage_rate from public.meta_shadow_parity_totals
         where tenant_id = v_tenant and qualification = 'sql') <> 0.3333 then
    raise exception 'not_compared changed the wrong rate';
  end if;

  if (select count(*) from public.meta_shadow_parity_summary
      where tenant_id = v_tenant and domain_event_id = v_domain) <> 1 then
    raise exception 'summary cardinality is not one row per domain event';
  end if;
end;
$$;

rollback;
