-- Align leads.first_seen_at with Kommo created_at so dashboard date filters
-- match Kommo's "created today / in period" semantics.
update public.leads
set
  first_seen_at = to_timestamp((raw->>'created_at')::bigint),
  updated_at = now()
where raw ? 'created_at'
  and (raw->>'created_at') ~ '^[0-9]+$'
  and first_seen_at is distinct from to_timestamp((raw->>'created_at')::bigint);
