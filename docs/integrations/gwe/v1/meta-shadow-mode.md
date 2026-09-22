# GWE v1 — Meta CAPI shadow mode

During the migration, `qualification_history` is the transactional source for
GWE lifecycle domain events. The `qualification_history_record_gwe_shadow`
trigger accepts only rows with `source = 'gwe'` and a non-null
`connection_id`; Kommo and manual history rows do not create shadow events.

Each newly discovered milestone produces one deterministic pair:

```text
source_event_id: evt-123
domain event key: evt-123:lead.lifecycle.sql
integration key: evt-123:lead.lifecycle.sql:meta
```

Both uniqueness constraints make retries and reconciliation replays
idempotent. A snapshot that is `noop` or `stale_ignored` does not insert
`qualification_history`, so it cannot create a domain event or outbox row.
Multiple milestones discovered in one snapshot produce separate events.

The integration outbox is intentionally constrained to `status = 'shadow'`.
There is no claim function or publisher for this table in this migration, and
the shadow trigger performs no network I/O. Its payload contains the source
event, lead, qualification, event type, timestamp, value, currency, and UTM
attribution needed to compare it with the legacy Meta CAPI request.
