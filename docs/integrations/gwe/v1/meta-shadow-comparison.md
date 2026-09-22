# GWE v1 — Legacy versus Meta shadow comparison

The comparison layer is observational. It does not claim jobs, publish the
integration outbox, or call Meta. It materializes one result per shadow domain
event in `meta_shadow_comparisons`.

`compare_meta_shadow_event` resolves the corresponding legacy
`send_meta_capi_event` job through `qualification_history_id`, then compares
the semantic fields available before dispatch: qualification, event mapping,
value, currency, attribution-ready payload, and event time. Legacy and shadow
event IDs are not required to be equal.

The shadow payload is read from `integration_outbox` as materialized at event
creation. It is never rebuilt from the current lead, so later lead changes
cannot rewrite historical comparison input.
