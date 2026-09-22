# GWE v1 — Meta shadow parity observation

`meta_shadow_parity_summary` exposes one read-only row per materialized
comparison, including tenant, connection, provider, qualification, result, and
comparison date. `meta_shadow_parity_totals` aggregates those rows by the same
dimensions and reports matched events, every mismatch class, non-comparable
counts, and `match_rate`.

The views do not claim jobs, mutate comparisons, or call Meta. They are
observability surfaces for the evidence phase before any publisher cutover.
`match_rate` is calculated over all recorded comparison rows; missing or
non-comparable outcomes remain visible as separate counters and are not
silently discarded.
