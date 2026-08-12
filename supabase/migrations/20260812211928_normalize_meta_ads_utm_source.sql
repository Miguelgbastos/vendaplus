-- Collapse Meta / Meta Ads / meta_ads (and similar) into the canonical origin "Meta ADS".
update public.leads
set
  utm_source = 'Meta ADS',
  updated_at = now()
where utm_source is not null
  and lower(regexp_replace(btrim(utm_source), '[^a-zA-Z0-9]+', '', 'g'))
    in ('meta', 'metaads', 'metaad');
