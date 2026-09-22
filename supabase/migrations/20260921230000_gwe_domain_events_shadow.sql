-- GWE domain events and Meta shadow outbox.
-- This migration records the new intent without dispatching anything externally.

create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connection_id uuid not null references public.crm_connections (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  source_event_id text not null,
  event_type text not null,
  event_key text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint domain_events_connection_source_type_unique
    unique (connection_id, source_event_id, event_type)
);

create index domain_events_lead_idx
  on public.domain_events (tenant_id, lead_id, created_at desc);

create table public.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  domain_event_id uuid not null references public.domain_events (id) on delete cascade,
  destination text not null,
  event_type text not null,
  event_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'shadow',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_outbox_domain_destination_unique
    unique (domain_event_id, destination),
  constraint integration_outbox_shadow_only_check check (status = 'shadow')
);

create index integration_outbox_shadow_idx
  on public.integration_outbox (tenant_id, destination, created_at desc);

create or replace function private.record_gwe_shadow_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_event_id text;
  v_event_key text;
  v_domain public.domain_events%rowtype;
  v_lead public.leads%rowtype;
  v_payload jsonb;
begin
  if new.source <> 'gwe' or new.connection_id is null
     or new.source_event_id is null then
    return new;
  end if;

  v_source_event_id := new.source_event_id;
  v_event_key := new.connection_id::text || ':' || v_source_event_id
    || ':lead.lifecycle.'
    || new.to_qualification::text;

  select l.* into v_lead
  from public.leads l
  where l.id = new.lead_id;

  v_payload := jsonb_build_object(
    'event_id', v_event_key,
    'source_event_id', v_source_event_id,
    'event_type', 'lead.lifecycle.' || new.to_qualification::text || '_reached',
    'lead_id', new.lead_id,
    'qualification', new.to_qualification,
    'occurred_at', new.changed_at,
    'value', v_lead.price,
    'currency', 'BRL',
    'attribution', jsonb_build_object(
      'utm_source', v_lead.utm_source,
      'utm_medium', v_lead.utm_medium,
      'utm_campaign', v_lead.utm_campaign,
      'utm_content', v_lead.utm_content,
      'utm_term', v_lead.utm_term
    )
  );

  insert into public.domain_events (
    tenant_id, connection_id, lead_id, source_event_id, event_type, event_key,
    payload, occurred_at
  ) values (
    new.tenant_id, new.connection_id, new.lead_id, v_source_event_id,
    'lead.lifecycle.' || new.to_qualification::text || '_reached',
    v_event_key, v_payload, new.changed_at
  )
  on conflict (connection_id, source_event_id, event_type) do nothing
  returning * into v_domain;

  if v_domain.id is not null then
    insert into public.integration_outbox (
      tenant_id, domain_event_id, destination, event_type, event_key, payload
    ) values (
      new.tenant_id, v_domain.id, 'meta_capi',
      'would_send_meta_event', v_event_key || ':meta', v_payload
    )
    on conflict (domain_event_id, destination) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function private.record_gwe_shadow_event() from public;
grant execute on function private.record_gwe_shadow_event() to postgres, service_role;

create trigger qualification_history_record_gwe_shadow
  after insert on public.qualification_history
  for each row execute function private.record_gwe_shadow_event();

alter table public.domain_events enable row level security;
alter table public.integration_outbox enable row level security;

create policy domain_events_select_member
  on public.domain_events for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy integration_outbox_select_member
  on public.integration_outbox for select to authenticated
  using (public.is_tenant_member(tenant_id));

revoke all on table public.domain_events, public.integration_outbox from anon, authenticated;
grant select on table public.domain_events, public.integration_outbox to authenticated;
grant all on table public.domain_events, public.integration_outbox to service_role;
