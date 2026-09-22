begin;

do $$
declare
  v_tenant uuid := gen_random_uuid();
  v_connection uuid := gen_random_uuid();
  v_lead uuid := gen_random_uuid();
  v_source_event text := 'compare-' || gen_random_uuid()::text;
  v_history uuid;
  v_domain uuid;
  v_result record;
begin
  insert into public.tenants (id, name, slug)
  values (v_tenant, 'GWE comparison test', 'gwe-compare-' || substr(v_tenant::text, 1, 8));
  insert into public.crm_connections (id, tenant_id, provider, name)
  values (v_connection, v_tenant, 'gwe', 'Comparison test');
  insert into public.leads (
    id, tenant_id, connection_id, external_lead_id, name, price, raw
  ) values (
    v_lead, v_tenant, v_connection, 'compare-lead', 'Compare lead', 125, '{}'::jsonb
  );
  insert into public.meta_capi_event_mappings (
    tenant_id, qualification, event_name, currency
  ) values (v_tenant, 'sql', 'Lead', 'BRL');

  insert into public.qualification_history (
    tenant_id, lead_id, connection_id, source_event_id,
    to_qualification, source, metadata
  ) values (
    v_tenant, v_lead, v_connection, v_source_event,
    'sql', 'gwe', '{}'::jsonb
  ) returning id into v_history;

  select id into v_domain
  from public.domain_events
  where tenant_id = v_tenant and source_event_id = v_source_event;

  insert into public.jobs (
    tenant_id, job_type, status, payload
  ) values (
    v_tenant, 'send_meta_capi_event', 'pending',
    jsonb_build_object(
      'lead_id', v_lead,
      'qualification', 'sql',
      'occurred_at', (
        select changed_at from public.qualification_history where id = v_history
      ),
      'event_id', 'qh-' || v_history::text,
      'qualification_history_id', v_history,
      'meta_event_name', 'Lead',
      'value', 125,
      'currency', 'BRL',
      'event_time_source', 'qualification_history.changed_at',
      'attribution', jsonb_build_object(
        'utm_source', null,
        'utm_medium', null,
        'utm_campaign', null,
        'utm_content', null,
        'utm_term', null
      )
    )
  );

  select * into v_result
  from public.compare_meta_shadow_event(v_domain);
  if v_result.result <> 'matched' then
    raise exception 'expected matched, got %', v_result.result;
  end if;

  if (select count(*) from public.meta_shadow_comparisons
      where domain_event_id = v_domain) <> 1 then
    raise exception 'comparison was not materialized';
  end if;
  if (select comparator_version from public.meta_shadow_comparisons
      where domain_event_id = v_domain) <> 1 then
    raise exception 'unexpected comparator version';
  end if;
  if (select legacy_payload_hash from public.meta_shadow_comparisons
      where domain_event_id = v_domain) is null
     or (select shadow_payload_hash from public.meta_shadow_comparisons
         where domain_event_id = v_domain) is null then
    raise exception 'comparison evidence hashes were not stored';
  end if;

  update public.leads set price = 999 where id = v_lead;
  select * into v_result
  from public.compare_meta_shadow_event(v_domain);
  if v_result.result <> 'matched' then
    raise exception 'historical payload changed after lead update: % / %',
      v_result.result, v_result.differences;
  end if;
  if (select count(*) from public.meta_shadow_comparisons
      where domain_event_id = v_domain) <> 1 then
    raise exception 'comparison is not idempotent';
  end if;
  if (select (shadow_payload->>'value')::numeric
      from public.meta_shadow_comparisons
      where domain_event_id = v_domain) <> 125 then
    raise exception 'shadow evidence snapshot was not preserved';
  end if;

  update public.jobs
  set payload = jsonb_set(payload, '{value}', '999'::jsonb)
  where id = (
    select legacy_job_id
    from public.meta_shadow_comparisons
    where domain_event_id = v_domain
  );
  select * into v_result
  from public.compare_meta_shadow_event(v_domain);
  if v_result.result <> 'value_mismatch'
     or (v_result.differences->>'legacy_value')::numeric <> 999
     or (v_result.differences->>'shadow_value')::numeric <> 125 then
    raise exception 'expected historical value mismatch, got % / %',
      v_result.result, v_result.differences;
  end if;
end;
$$;

rollback;
