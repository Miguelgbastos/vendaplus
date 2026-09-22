# GWE v1 — Meta shadow parity observation

`meta_shadow_parity_summary` exposes one read-only row per materialized
comparison, including tenant, connection, provider, qualification, result, and
comparison date. `meta_shadow_parity_totals` aggregates those rows by the same
dimensions and reports matched events, every mismatch class, non-comparable
counts, `match_rate`, and `coverage_rate`.

The views do not claim jobs, mutate comparisons, or call Meta. They are
observability surfaces for the evidence phase before any publisher cutover.
The driving population is eligible GWE `domain_events`, so a missing shadow
outbox row remains visible instead of disappearing from the metrics.
`comparable_events` contains only matched and semantic mismatch results.
Missing, not-compared, and other non-comparable outcomes remain visible as
separate counters. `match_rate` is matched/comparable and
`coverage_rate` is comparable/expected. Day buckets use UTC.
