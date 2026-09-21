-- Reproducible PR4 processing/reconciliation smoke test.
begin;

do $$
declare
  v_tenant uuid := gen_random_uuid();
  v_connection uuid := gen_random_uuid();
  v_raw uuid := gen_random_uuid();
  v_lead uuid;
  v_claim public.processing_outbox;
  v_result record;
  v_snapshot jsonb := jsonb_build_object(
    'tenantId', v_tenant::text,
    'connectionId', v_connection::text,
    'provider', 'gwe',
    'sourceEvent', jsonb_build_object(
      'id', 'process-event-1',
      'occurredAt', '2026-09-21T19:00:00Z',
      'sequence', 10
    ),
    'externalLeadId', 'external-lead-1',
    'identity', jsonb_build_object('name', 'Maria', 'email', null, 'phone', null),
    'crm', jsonb_build_object(
      'ownerId', null,
      'pipeline', jsonb_build_object('id', 'pipeline-1', 'name', 'Default'),
      'stage', jsonb_build_object('id', 'stage-1', 'name', 'SQL')
    ),
    'commercial', jsonb_build_object('amount', null, 'currency', null),
    'lifecycle', jsonb_build_object(
      'currentStage', 'sql',
      'historyComplete', true,
      'milestones', jsonb_build_object(
        'mql', jsonb_build_object('reached', true),
        'sal', jsonb_build_object('reached', true),
        'sql', jsonb_build_object('reached', true)
      )
    ),
    'attribution', jsonb_build_object(
      'utmSource', null, 'utmMedium', null, 'utmCampaign', null,
      'utmContent', null, 'utmTerm', null
    ),
    'custom', '{}'::jsonb
  );
begin
  insert into public.tenants(id, name, slug)
  values (v_tenant, 'GWE Processing Test', 'gwe-processing-' || replace(v_tenant::text, '-', ''));
  insert into public.crm_connections(id, tenant_id, provider, name)
  values (v_connection, v_tenant, 'gwe', 'Processing test');
  insert into public.raw_events(
    id, tenant_id, connection_id, provider, event_type,
    idempotency_key, external_event_id, payload, payload_hash
  ) values (
    v_raw, v_tenant, v_connection, 'gwe', 'lead.snapshot',
    'process-event-1', 'process-event-1', '{}'::jsonb, 'hash'
  );
  insert into public.event_processing(raw_event_id) values(v_raw);
  insert into public.processing_outbox(raw_event_id) values(v_raw);

  select * into v_claim
  from public.claim_processing_outbox(1, 'sql-test', 300);
  if v_claim.raw_event_id <> v_raw or v_claim.status <> 'processing' then
    raise exception 'outbox was not claimed';
  end if;

  select * into v_result
  from public.reconcile_crm_lead_snapshot(v_raw, v_snapshot);
  if v_result.outcome <> 'applied' or v_result.new_milestones <> 3 then
    raise exception 'first snapshot was not applied correctly';
  end if;

  select id into v_lead
  from public.leads
  where connection_id = v_connection and external_lead_id = 'external-lead-1';
  if v_lead is null then raise exception 'lead was not created'; end if;
  if (select count(*) from public.qualification_history
      where lead_id = v_lead and source = 'gwe') <> 3 then
    raise exception 'milestones were not recorded';
  end if;
  if (select status from public.event_processing where raw_event_id = v_raw) <> 'processed' then
    raise exception 'event was not marked processed';
  end if;
  raise notice 'gwe processing applied';
end;
$$;

rollback;
