-- Administrative parity views. Read-only aggregation; no dispatch or mutation.

create or replace view public.meta_shadow_parity_summary
with (security_invoker = true)
as
select
  de.tenant_id,
  de.id as domain_event_id,
  de.connection_id,
  cc.provider,
  (de.payload->>'qualification')::public.qualification_stage as qualification,
  case
    when io.id is null then 'missing_shadow'
    when c.id is null then 'not_compared'
    else c.result
  end as result,
  (coalesce(c.compared_at, de.created_at) at time zone 'UTC')::date as compared_on,
  coalesce(c.compared_at, de.created_at) as compared_at,
  de.occurred_at,
  c.id as comparison_id,
  io.id as integration_outbox_id
from public.domain_events de
join public.crm_connections cc on cc.id = de.connection_id
left join public.integration_outbox io
  on io.domain_event_id = de.id
 and io.destination = 'meta_capi'
left join public.meta_shadow_comparisons c on c.domain_event_id = de.id
where de.event_type like 'lead.lifecycle.%_reached';

create or replace view public.meta_shadow_parity_totals
with (security_invoker = true)
as
select
  tenant_id,
  provider,
  connection_id,
  qualification,
  compared_on,
  count(*) filter (where result = 'matched') as matched_events,
  count(*) filter (where result in (
    'matched',
    'qualification_mismatch',
    'event_type_mismatch',
    'value_mismatch',
    'currency_mismatch',
    'attribution_mismatch',
    'timestamp_mismatch'
  )) as comparable_events,
  count(*) as expected_events,
  count(*) filter (where result <> 'missing_shadow') as shadow_events,
  count(*) filter (where result = 'missing_legacy') as missing_legacy,
  count(*) filter (where result = 'missing_shadow') as missing_shadow,
  count(*) filter (where result = 'not_compared') as not_compared,
  count(*) filter (where result = 'unexpected_duplicate') as unexpected_duplicate,
  count(*) filter (where result = 'qualification_mismatch') as qualification_mismatch,
  count(*) filter (where result = 'event_type_mismatch') as event_type_mismatch,
  count(*) filter (where result = 'value_mismatch') as value_mismatch,
  count(*) filter (where result = 'currency_mismatch') as currency_mismatch,
  count(*) filter (where result = 'attribution_mismatch') as attribution_mismatch,
  count(*) filter (where result = 'timestamp_mismatch') as timestamp_mismatch,
  count(*) filter (where result = 'legacy_evidence_missing') as legacy_evidence_missing,
  round(
    count(*) filter (where result = 'matched')::numeric
    / nullif(count(*) filter (where result in (
      'matched',
      'qualification_mismatch',
      'event_type_mismatch',
      'value_mismatch',
      'currency_mismatch',
      'attribution_mismatch',
      'timestamp_mismatch'
    )), 0),
    4
  ) as match_rate,
  round(
    count(*) filter (where result in (
      'matched',
      'qualification_mismatch',
      'event_type_mismatch',
      'value_mismatch',
      'currency_mismatch',
      'attribution_mismatch',
      'timestamp_mismatch'
    ))::numeric / nullif(count(*), 0),
    4
  ) as coverage_rate
from public.meta_shadow_parity_summary
group by tenant_id, provider, connection_id, qualification, compared_on;

revoke all on table public.meta_shadow_parity_summary from anon, authenticated;
revoke all on table public.meta_shadow_parity_totals from anon, authenticated;
grant select on public.meta_shadow_parity_summary to authenticated, service_role;
grant select on public.meta_shadow_parity_totals to authenticated, service_role;
