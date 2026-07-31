-- Dashboard report filter indexes (tenant-scoped).
-- Apply on remote like other Venda+ migrations. CONCURRENTLY cannot run inside a transaction.

create index if not exists leads_tenant_first_seen_idx
  on public.leads (tenant_id, first_seen_at desc);

create index if not exists leads_tenant_utm_campaign_idx
  on public.leads (tenant_id, utm_campaign);

create index if not exists leads_tenant_utm_medium_idx
  on public.leads (tenant_id, utm_medium);

create index if not exists leads_tenant_responsible_idx
  on public.leads (tenant_id, responsible_user_id);
