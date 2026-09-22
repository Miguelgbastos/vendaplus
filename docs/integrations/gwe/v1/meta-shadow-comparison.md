# GWE v1 — Legacy versus Meta shadow comparison

The comparison layer is observational. It does not claim jobs, publish the
integration outbox, or call Meta. It materializes one result per shadow domain
event in `meta_shadow_comparisons`. Each row also stores both payload snapshots and
their MD5 fingerprints, so the result remains auditable even if a legacy job
is later edited or removed.

`compare_meta_shadow_event` resolves the corresponding legacy
`send_meta_capi_event` job through `qualification_history_id`, then compares
the semantic fields captured in both historical payloads: qualification, event
mapping, value, currency, attribution, and event time. The legacy trigger
records `event_time_source = qualification_history.changed_at`; this is the
timestamp semantic used by both payloads. Legacy and shadow event IDs are not
required to be equal.

Both payloads are read as materialized at event creation. They are never
rebuilt from the current lead, so later lead changes cannot rewrite historical
comparison input.
