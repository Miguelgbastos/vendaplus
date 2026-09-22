begin;

do $$
declare
  v_tenant uuid := gen_random_uuid();
  v_connection uuid := gen_random_uuid();
  v_lead uuid := gen_random_uuid();
  v_source_event text := 'parity-' || gen_random_uuid()::text;
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

  insert into public.meta_shadow_comparisons (
    tenant_id, domain_event_id, result, shadow_payload, shadow_payload_hash
  )
  select
    v_tenant, id, 'matched',
    jsonb_build_object('qualification', 'sql'),
    md5(jsonb_build_object('qualification', 'sql')::text)
  from public.domain_events
  where tenant_id = v_tenant and source_event_id = v_source_event;

  if (select matched_events from public.meta_shadow_parity_totals
      where tenant_id = v_tenant and qualification = 'sql') <> 1 then
    raise exception 'matched denominator was not aggregated';
  end if;

  if (select match_rate from public.meta_shadow_parity_totals
      where tenant_id = v_tenant and qualification = 'sql') <> 1.0000 then
    raise exception 'match rate was not calculated';
  end if;
end;
$$;

rollback;
