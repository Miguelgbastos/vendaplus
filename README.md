# Venda+

MVP de analytics de marketing e comercial com autenticação Supabase, multi-tenant e integração Kommo **sem n8n**.

## Stack

- Next.js 16 (App Router) + React 19
- Supabase Auth (SSR) com `src/proxy.ts` e `auth.getClaims()`
- Postgres (schema em `supabase/migrations/`) + RLS
- shadcn-style UI (Radix + Tailwind) dark, pt-BR
- Fila interna (`jobs` + `claim_jobs` com `FOR UPDATE SKIP LOCKED`)

## Arquitetura

```
Kommo (integração privada por tenant)
  → UI /kommo salva subdomain + Integration ID + Secret Key (AES-GCM)
  → OAuth start/callback usam credenciais DAQUELE tenant
  → webhook /api/webhooks/kommo/[token]
  → raw_events + jobs
  → worker processa com refresh OAuth do mesmo tenant
```

### Módulos principais

| Área | Caminho |
|------|---------|
| Proxy Auth | `src/proxy.ts` |
| Clientes Supabase | `src/lib/supabase/*` |
| AES-GCM + state OAuth | `src/lib/crypto.ts` |
| Cliente Kommo (por tenant) | `src/lib/kommo/client.ts` |
| Credenciais API | `src/app/api/kommo/credentials/route.ts` |
| Migrations | `supabase/migrations/` |

## Setup

1. Copie o ambiente:

```bash
cp .env.example .env.local
```

2. Preencha as chaves (não versionadas):

- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WORKER_SECRET`
- `TOKEN_ENCRYPTION_KEY` — 64 hex (32 bytes), ex.: `openssl rand -hex 32`
- `OAUTH_STATE_SECRET`
- `NEXT_PUBLIC_APP_URL` — a Redirect URI do Kommo será `{APP_URL}/api/kommo/oauth/callback`

3. Aplique as migrations no Supabase (você aplica o remoto). Localmente:

```bash
# 0001_initial.sql + 20260731034402_kommo_private_credentials_per_tenant.sql
```

4. Instale e rode:

```bash
npm install
npm run dev
```

5. Em **Kommo**, configure a integração privada por tenant (Integration ID + Secret Key) e autorize.

6. Processe a fila periodicamente:

```bash
curl -X POST "$NEXT_PUBLIC_APP_URL/api/workers/process" \
  -H "Authorization: Bearer $WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"limit":10}'
```

## Fluxos de produto

- **Auth:** `/login`, `/cadastro`
- **Shell:** dashboards, Admin, assistente Kommo
- **Kommo:** credenciais por tenant → OAuth → webhook
- **Sem** `KOMMO_CLIENT_ID` / `KOMMO_CLIENT_SECRET` globais

## Segurança

- RLS em todas as tabelas `public`
- `integration_id`, `client_secret_encrypted`, access/refresh tokens: **sem SELECT** para `authenticated`
- Secret Key criptografada (AES-GCM); nunca retornada ao client
- OAuth state one-time; isolamento estrito por `tenant_id` no load de credenciais
- Worker protegido por `WORKER_SECRET`

## Scripts

```bash
npm run lint
npm run build
npm run dev
```
