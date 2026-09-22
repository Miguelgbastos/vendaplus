-- Administrative parity views. Read-only aggregation; no dispatch or mutation.

create or replace view public.meta_shadow_parity_summary
with (security_invoker = true)
as
select
  c.tenant_id,
  c.domain_event_id,
  de.connection_id,
  cc.provider,
  (c.shadow_payload->>'qualification')::public.qualification_stage as qualification,
  c.result,
  c.compared_at::date as compared_on,
  c.compared_at
from public.meta_shadow_comparisons c
join public.domain_events de on de.id = c.domain_event_id
join public.crm_connections cc on cc.id = de.connection_id;

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
  count(*) as comparable_events,
  count(*) filter (where result = 'missing_legacy') as missing_legacy,
  count(*) filter (where result = 'missing_shadow') as missing_shadow,
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
    / nullif(count(*), 0),
    4
  ) as match_rate
from public.meta_shadow_parity_summary
group by tenant_id, provider, connection_id, qualification, compared_on;

revoke all on table public.meta_shadow_parity_summary from anon, authenticated;
revoke all on table public.meta_shadow_parity_totals from anon, authenticated;
grant select on public.meta_shadow_parity_summary to authenticated, service_role;
grant select on public.meta_shadow_parity_totals to authenticated, service_role;
