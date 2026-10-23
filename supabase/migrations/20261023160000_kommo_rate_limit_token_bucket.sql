-- Rate limit distribuído para a API da Kommo (limite ~7 req/s por conta).
-- O limitador anterior era in-memory por processo: em multi-instância/serverless
-- cada runtime tinha seu próprio contador e a soma estourava o limite (429 -> 403
-- por IP). Este token-bucket vive no Postgres e é compartilhado entre instâncias.
--
-- Semântica "reserving": cada chamada consome 1 token (podendo ficar negativo =
-- backlog agendado) e retorna quantos milissegundos o chamador deve esperar antes
-- de prosseguir (0 = pode ir agora). Isso espaça as requisições globalmente a
-- ~p_rate/s com rajada de até p_burst, por tenant (cada tenant = conta Kommo).

create table if not exists public.kommo_rate_limits (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  tokens double precision not null,
  updated_at timestamptz not null default now()
);

alter table public.kommo_rate_limits enable row level security;
-- Sem policies: acesso apenas via função SECURITY DEFINER abaixo (service_role).
revoke all on table public.kommo_rate_limits from public, anon, authenticated;

create or replace function public.kommo_rate_limit_acquire(
  p_tenant_id uuid,
  p_rate double precision default 5,
  p_burst double precision default 5
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tokens double precision;
  v_updated timestamptz;
  v_elapsed double precision;
  v_rate double precision := p_rate;
  v_burst double precision := p_burst;
begin
  if p_tenant_id is null then
    return 0;
  end if;
  if v_rate is null or v_rate <= 0 then
    v_rate := 5;
  end if;
  if v_burst is null or v_burst < 1 then
    v_burst := v_rate;
  end if;

  insert into public.kommo_rate_limits (tenant_id, tokens, updated_at)
  values (p_tenant_id, v_burst, now())
  on conflict (tenant_id) do nothing;

  select tokens, updated_at
    into v_tokens, v_updated
  from public.kommo_rate_limits
  where tenant_id = p_tenant_id
  for update;

  -- Recarrega os tokens pelo tempo decorrido (cap na rajada) e consome um.
  v_elapsed := greatest(0, extract(epoch from (now() - v_updated)));
  v_tokens := least(v_burst, v_tokens + v_elapsed * v_rate);
  v_tokens := v_tokens - 1;

  -- Limita o backlog a ~30s para não gerar esperas patológicas.
  v_tokens := greatest(v_tokens, -(v_rate * 30));

  update public.kommo_rate_limits
  set tokens = v_tokens, updated_at = now()
  where tenant_id = p_tenant_id;

  if v_tokens >= 0 then
    return 0;
  end if;

  -- Espera até o slot reservado ficar disponível.
  return ceil((-v_tokens) / v_rate * 1000.0)::integer;
end;
$$;

revoke all on function public.kommo_rate_limit_acquire(uuid, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.kommo_rate_limit_acquire(uuid, double precision, double precision)
  to service_role;
