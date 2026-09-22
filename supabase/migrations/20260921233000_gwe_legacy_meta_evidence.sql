-- Preserve the legacy Meta request inputs at job creation for historical
-- comparison. This does not change dispatch behavior.

create or replace function private.enqueue_meta_capi_from_qualification_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_mapping public.meta_capi_event_mappings%rowtype;
begin
  select * into v_lead
  from public.leads
  where id = new.lead_id;

  select m.* into v_mapping
  from public.meta_capi_event_mappings m
  join public.meta_capi_connections c
    on c.tenant_id = m.tenant_id
   and c.is_enabled = true
   and c.pixel_id is not null
   and c.access_token_encrypted is not null
  where m.tenant_id = new.tenant_id
    and m.qualification = new.to_qualification
    and m.is_active = true;

  if v_mapping.id is not null then
    insert into public.jobs (
      tenant_id, job_type, status, priority, payload, max_attempts
    ) values (
      new.tenant_id, 'send_meta_capi_event', 'pending', 200,
      jsonb_build_object(
        'lead_id', new.lead_id,
        'qualification', new.to_qualification,
        'occurred_at', new.changed_at,
        'event_time_source', 'qualification_history.changed_at',
        'event_id', 'qh-' || new.id::text,
        'qualification_history_id', new.id,
        'meta_event_name', v_mapping.event_name,
        'value', v_lead.price,
        'currency', v_mapping.currency,
        'attribution', jsonb_build_object(
          'utm_source', v_lead.utm_source,
          'utm_medium', v_lead.utm_medium,
          'utm_campaign', v_lead.utm_campaign,
          'utm_content', v_lead.utm_content,
          'utm_term', v_lead.utm_term
        )
      ),
      5
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;
