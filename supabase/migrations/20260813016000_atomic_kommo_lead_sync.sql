-- Atomic lead sync: advisory xact lock + upsert + history in one transaction.

create or replace function public.sync_kommo_lead_state(
  p_tenant_id uuid,
  p_kommo_lead_id text,
  p_lead jsonb,
  p_contact jsonb default null,
  p_transitions public.qualification_stage[] default '{}'::public.qualification_stage[],
  p_from_qualification public.qualification_stage default null,
  p_stage_changed boolean default false,
  p_previous_pipeline_id text default null,
  p_previous_status_id text default null,
  p_previous_status_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact_id uuid;
  v_lead_id uuid;
  v_previous public.leads%rowtype;
  v_from public.qualification_stage;
  v_to public.qualification_stage;
  v_transition public.qualification_stage;
begin
  if p_kommo_lead_id is null or p_kommo_lead_id !~ '^[0-9]+$' then
    raise exception 'invalid_kommo_lead_id' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_tenant_id::text),
    hashtext(p_kommo_lead_id)
  );

  select * into v_previous
  from public.leads
  where tenant_id = p_tenant_id
    and kommo_lead_id = p_kommo_lead_id
  for update;

  if p_contact is not null and (p_contact ? 'kommo_contact_id') then
    insert into public.contacts (
      tenant_id, kommo_contact_id, name, email, phone, company, raw, last_seen_at, updated_at
    ) values (
      p_tenant_id,
      nullif(p_contact->>'kommo_contact_id', ''),
      p_contact->>'name',
      p_contact->>'email',
      p_contact->>'phone',
      p_contact->>'company',
      p_contact,
      now(),
      now()
    )
    on conflict (tenant_id, kommo_contact_id) do update
      set
        name = excluded.name,
        email = excluded.email,
        phone = excluded.phone,
        company = excluded.company,
        raw = excluded.raw,
        last_seen_at = now(),
        updated_at = now()
    returning id into v_contact_id;
  end if;

  insert into public.leads (
    tenant_id,
    contact_id,
    kommo_lead_id,
    name,
    pipeline_id,
    status_id,
    status_name,
    price,
    responsible_user_id,
    qualification,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    custom_fields,
    raw,
    first_seen_at,
    last_seen_at,
    closed_at,
    updated_at
  ) values (
    p_tenant_id,
    coalesce(v_contact_id, null),
    p_kommo_lead_id,
    p_lead->>'name',
    p_lead->>'pipeline_id',
    p_lead->>'status_id',
    p_lead->>'status_name',
    nullif(p_lead->>'price', '')::numeric,
    p_lead->>'responsible_user_id',
    nullif(p_lead->>'qualification', '')::public.qualification_stage,
    p_lead->>'utm_source',
    p_lead->>'utm_medium',
    p_lead->>'utm_campaign',
    p_lead->>'utm_content',
    p_lead->>'utm_term',
    coalesce(p_lead->'custom_fields', '{}'::jsonb),
    coalesce(p_lead->'raw', '{}'::jsonb),
    coalesce(nullif(p_lead->>'first_seen_at', '')::timestamptz, now()),
    now(),
    nullif(p_lead->>'closed_at', '')::timestamptz,
    now()
  )
  on conflict (tenant_id, kommo_lead_id) do update
    set
      contact_id = coalesce(excluded.contact_id, public.leads.contact_id),
      name = excluded.name,
      pipeline_id = excluded.pipeline_id,
      status_id = excluded.status_id,
      status_name = excluded.status_name,
      price = excluded.price,
      responsible_user_id = excluded.responsible_user_id,
      qualification = excluded.qualification,
      utm_source = excluded.utm_source,
      utm_medium = excluded.utm_medium,
      utm_campaign = excluded.utm_campaign,
      utm_content = excluded.utm_content,
      utm_term = excluded.utm_term,
      custom_fields = excluded.custom_fields,
      raw = excluded.raw,
      first_seen_at = coalesce(
        public.leads.first_seen_at,
        nullif(excluded.first_seen_at, 'epoch'::timestamptz),
        excluded.first_seen_at
      ),
      last_seen_at = now(),
      closed_at = excluded.closed_at,
      updated_at = now()
  returning id into v_lead_id;

  -- History only when qualification actually changed vs locked previous row.
  if p_transitions is not null
     and cardinality(p_transitions) > 0
     and (
       v_previous.id is null
       or v_previous.qualification is distinct from (nullif(p_lead->>'qualification', '')::public.qualification_stage)
     )
  then
    v_from := case
      when v_previous.id is null then null
      else v_previous.qualification
    end;
    foreach v_transition in array p_transitions
    loop
      v_to := v_transition;
      insert into public.qualification_history (
        tenant_id, lead_id, from_qualification, to_qualification, source, metadata
      ) values (
        p_tenant_id,
        v_lead_id,
        v_from,
        v_to,
        'kommo',
        jsonb_build_object(
          'inferred', v_to is distinct from (nullif(p_lead->>'qualification', '')::public.qualification_stage),
          'initial', v_previous.id is null
        )
      );
      v_from := v_to;
    end loop;
  end if;

  if p_stage_changed and v_previous.id is not null then
    insert into public.stage_history (
      tenant_id, lead_id, from_pipeline_id, from_status_id, from_status_name,
      to_pipeline_id, to_status_id, to_status_name, source
    ) values (
      p_tenant_id,
      v_lead_id,
      p_previous_pipeline_id,
      p_previous_status_id,
      p_previous_status_name,
      p_lead->>'pipeline_id',
      p_lead->>'status_id',
      p_lead->>'status_name',
      'kommo'
    );
  end if;

  return v_lead_id;
end;
$$;

revoke all on function public.sync_kommo_lead_state(
  uuid, text, jsonb, jsonb, public.qualification_stage[], public.qualification_stage, boolean, text, text, text
) from public, anon, authenticated;
grant execute on function public.sync_kommo_lead_state(
  uuid, text, jsonb, jsonb, public.qualification_stage[], public.qualification_stage, boolean, text, text, text
) to service_role;
