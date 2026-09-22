-- Materialized legacy-vs-shadow comparison.
-- This migration performs no external dispatch and does not claim either queue.

create table public.meta_shadow_comparisons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  domain_event_id uuid references public.domain_events (id) on delete set null,
  legacy_job_id uuid references public.jobs (id) on delete set null,
  legacy_payload jsonb,
  legacy_payload_hash text,
  shadow_payload jsonb,
  shadow_payload_hash text,
  result text not null,
  differences jsonb not null default '{}'::jsonb,
  comparator_version smallint not null default 1,
  compared_at timestamptz not null default now(),
  constraint meta_shadow_comparisons_result_check check (
    result in (
      'matched',
      'missing_legacy',
      'missing_shadow',
      'event_type_mismatch',
      'qualification_mismatch',
      'value_mismatch',
      'currency_mismatch',
      'attribution_mismatch',
      'timestamp_mismatch',
      'unexpected_duplicate',
      'legacy_evidence_missing'
    )
  ),
  constraint meta_shadow_comparisons_domain_unique
    unique (domain_event_id)
);

create index meta_shadow_comparisons_tenant_idx
  on public.meta_shadow_comparisons (tenant_id, compared_at desc);

create or replace function public.compare_meta_shadow_event(p_domain_event_id uuid)
returns table (comparison_id uuid, result text, differences jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain public.domain_events%rowtype;
  v_shadow public.integration_outbox%rowtype;
  v_history public.qualification_history%rowtype;
  v_mapping public.meta_capi_event_mappings%rowtype;
  v_job public.jobs%rowtype;
  v_job_count integer := 0;
  v_result text := 'matched';
  v_differences jsonb := '{}'::jsonb;
  v_expected_event_type text;
  v_shadow_value numeric;
  v_legacy_value numeric;
  v_shadow_currency text;
  v_legacy_currency text;
  v_shadow_occurred_at timestamptz;
  v_legacy_occurred_at timestamptz;
begin
  select * into v_domain
  from public.domain_events
  where id = p_domain_event_id
  for share;

  if not found then
    raise exception 'shadow_domain_event_not_found' using errcode = '22023';
  end if;

  select * into v_shadow
  from public.integration_outbox
  where domain_event_id = p_domain_event_id
    and destination = 'meta_capi'
  for share;

  if not found then
    insert into public.meta_shadow_comparisons (
      tenant_id, domain_event_id, result, differences,
      shadow_payload, shadow_payload_hash, comparator_version
    ) values (
      v_domain.tenant_id, v_domain.id, 'missing_shadow',
      jsonb_build_object('reason', 'meta_shadow_outbox_missing'),
      null, null, 1
    )
    on conflict (domain_event_id) do update
      set result = excluded.result,
          differences = excluded.differences,
          comparator_version = excluded.comparator_version,
          compared_at = now()
    returning meta_shadow_comparisons.id,
      meta_shadow_comparisons.result,
      meta_shadow_comparisons.differences
    into comparison_id, result, differences;
    return next;
    return;
  end if;

  select * into v_history
  from public.qualification_history
  where tenant_id = v_domain.tenant_id
    and lead_id = v_domain.lead_id
    and connection_id = v_domain.connection_id
    and source_event_id = v_domain.source_event_id
    and to_qualification = (v_domain.payload->>'qualification')::public.qualification_stage
  order by created_at
  limit 1;

  select count(*) into v_job_count
  from public.jobs
  where tenant_id = v_domain.tenant_id
    and job_type = 'send_meta_capi_event'
    and payload->>'qualification_history_id' = v_history.id::text;

  if v_job_count = 0 then
    v_result := 'missing_legacy';
    v_differences := jsonb_build_object('legacy_job', 'missing');
  elsif v_job_count > 1 then
    v_result := 'unexpected_duplicate';
    v_differences := jsonb_build_object('legacy_job_count', v_job_count);
  else
    select * into v_job
    from public.jobs
    where tenant_id = v_domain.tenant_id
      and job_type = 'send_meta_capi_event'
      and payload->>'qualification_history_id' = v_history.id::text
    limit 1;

    select * into v_mapping
    from public.meta_capi_event_mappings
    where tenant_id = v_domain.tenant_id
      and qualification = v_history.to_qualification
      and is_active = true;

    v_expected_event_type := coalesce(v_mapping.event_name, '');
    v_shadow_value := nullif(v_shadow.payload->>'value', '')::numeric;
    v_legacy_value := nullif(v_job.payload->>'value', '')::numeric;
    v_shadow_currency := v_shadow.payload->>'currency';
    v_legacy_currency := v_job.payload->>'currency';
    v_shadow_occurred_at := (v_shadow.payload->>'occurred_at')::timestamptz;
    v_legacy_occurred_at := (v_job.payload->>'occurred_at')::timestamptz;

    if v_mapping.id is null
       or v_job.payload->>'meta_event_name' is null
       or v_job.payload->>'value' is null
       or v_job.payload->>'currency' is null
       or v_job.payload->'attribution' is null then
      v_result := 'legacy_evidence_missing';
      v_differences := jsonb_build_object(
        'required_legacy_fields', jsonb_build_array(
          'meta_event_name', 'value', 'currency', 'attribution'
        )
      );
    elsif v_shadow.payload->>'qualification' <> v_job.payload->>'qualification' then
      v_result := 'qualification_mismatch';
      v_differences := jsonb_build_object(
        'legacy_qualification', v_job.payload->>'qualification',
        'shadow_qualification', v_shadow.payload->>'qualification'
      );
    elsif v_job.payload->>'meta_event_name' <> v_expected_event_type then
      v_result := 'event_type_mismatch';
      v_differences := jsonb_build_object(
        'expected_event_name', v_expected_event_type,
        'legacy_event_name', v_job.payload->>'meta_event_name'
      );
    elsif v_shadow_value is distinct from
      v_legacy_value then
      v_result := 'value_mismatch';
      v_differences := jsonb_build_object(
        'legacy_value', v_legacy_value,
        'shadow_value', v_shadow_value
      );
    elsif v_shadow_currency is distinct from v_legacy_currency then
      v_result := 'currency_mismatch';
      v_differences := jsonb_build_object(
        'legacy_currency', v_legacy_currency,
        'shadow_currency', v_shadow_currency,
        'expected_currency', v_mapping.currency
      );
    elsif v_shadow.payload->'attribution' is distinct from (
      v_job.payload->'attribution'
    ) then
      v_result := 'attribution_mismatch';
      v_differences := jsonb_build_object(
        'legacy_attribution', v_job.payload->'attribution',
        'shadow_attribution', v_shadow.payload->'attribution'
      );
    elsif v_shadow_occurred_at is distinct from
      v_legacy_occurred_at then
      v_result := 'timestamp_mismatch';
      v_differences := jsonb_build_object(
        'shadow_occurred_at', v_shadow_occurred_at,
        'legacy_occurred_at', v_legacy_occurred_at,
        'timestamp_semantics', 'qualification_history.changed_at'
      );
    end if;
  end if;

  insert into public.meta_shadow_comparisons (
    tenant_id, domain_event_id, legacy_job_id, result, differences,
    legacy_payload, legacy_payload_hash, shadow_payload, shadow_payload_hash,
    comparator_version
  ) values (
    v_domain.tenant_id, v_domain.id,
    case when v_job.id is null then null else v_job.id end,
    v_result, v_differences,
    v_job.payload, case when v_job.id is null then null else md5(v_job.payload::text) end,
    v_shadow.payload, md5(v_shadow.payload::text), 1
  )
  on conflict (domain_event_id) do update
    set legacy_job_id = excluded.legacy_job_id,
        result = excluded.result,
        differences = excluded.differences,
        legacy_payload = excluded.legacy_payload,
        legacy_payload_hash = excluded.legacy_payload_hash,
        shadow_payload = excluded.shadow_payload,
        shadow_payload_hash = excluded.shadow_payload_hash,
        comparator_version = excluded.comparator_version,
        compared_at = now()
  returning meta_shadow_comparisons.id,
    meta_shadow_comparisons.result,
    meta_shadow_comparisons.differences
  into comparison_id, result, differences;
  return next;
end;
$$;

revoke all on function public.compare_meta_shadow_event(uuid)
  from public, anon, authenticated;
grant execute on function public.compare_meta_shadow_event(uuid)
  to service_role;

alter table public.meta_shadow_comparisons enable row level security;

create policy meta_shadow_comparisons_select_member
  on public.meta_shadow_comparisons for select to authenticated
  using (public.is_tenant_member(tenant_id));

revoke all on table public.meta_shadow_comparisons from anon, authenticated;
grant select on public.meta_shadow_comparisons to authenticated;
grant all on table public.meta_shadow_comparisons to service_role;
