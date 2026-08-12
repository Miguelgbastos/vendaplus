# Inventário e decisões de arquitetura

## Estado encontrado

### Supabase

- Clientes browser e SSR usam `@supabase/ssr`; o servidor valida a sessão com `getClaims()`.
- O cliente administrativo usa uma chave server-only e não persiste sessão.
- A URL do projeto tinha um fallback hardcoded; ele foi removido para tornar o repositório público e neutro.
- O schema usa `tenants`, `tenant_users` e `tenant_id` em todas as entidades multiempresa.
- Todas as tabelas públicas existentes têm RLS. Funções privilegiadas têm grants explícitos.

### Kommo

- Uma conexão por empresa em `kommo_connections`.
- `integration_id`, Secret Key e tokens ficam server-only; segredos e tokens são criptografados com AES-256-GCM.
- OAuth state é descartável; webhooks, eventos, jobs e entidades carregam `tenant_id`.
- A configuração antes ficava numa rota principal `/kommo`.

### Usuários

- Supabase Auth mantém a identidade; `profiles` guarda o perfil da aplicação.
- `tenant_users` representa membership com `owner`, `admin`, `analyst` e `viewer`.
- A tela de membros exige empresa ativa e limita inclusão a owner/admin.

### Empresas

- A interface chamava o conceito alternadamente de tenant e organização.
- O cookie de empresa ativa e a API `/api/tenant/active` validam membership antes da troca.
- A criação atômica existente usa `create_tenant_with_owner`.

## Estrutura implementada

- `/configuracoes`: entrada administrativa única.
- `/configuracoes/supabase`: diagnóstico somente leitura, sem revelar valores de chaves.
- `/configuracoes/kommo`: fluxo existente do Kommo no novo agrupamento.
- `/configuracoes/meta-capi`: servidor de conversão Meta Ads por empresa.
- `/configuracoes/usuarios`: membros e permissões.
- `/configuracoes/empresas`: criação e seleção de empresas.
- Rotas antigas redirecionam temporariamente para preservar links.

### Meta Ads Conversions API (CAPI) por empresa

- `meta_capi_connections`: Pixel ID, Access Token de System User (AES-256-GCM
  via `TOKEN_ENCRYPTION_KEY`) e Test Event Code por `tenant_id`. Colunas
  sensíveis (access_token_encrypted) só via `service_role`.
- `meta_capi_event_mappings`: mapa `qualification → event_name` (Lead,
  Purchase, InitiateCheckout, ...). Owner/admin edita nomes, moeda, ativo/inativo
  e se envia `value` do lead.
- `meta_capi_events`: log auditável dos envios (event_id, HTTP status, fbtrace_id,
  payload sem PII em claro — apenas hashes SHA-256).
- Envio assíncrono: `processKommoJob` enfileira `send_meta_capi_event` a cada
  transição de qualificação. O worker existente processa ambos os `job_type`s
  e faz retry exponencial em 5xx/429.
- `src/lib/meta-capi/` isola hashing (email/phone/nome/external_id), builder do
  evento CAPI, client da Graph API (`v20.0/{pixel_id}/events`) e o dispatcher
  que grava o log.

## Estratégia de terminologia

O produto passa a dizer **empresa** em toda a interface. O contrato físico do banco permanece com `tenant*` porque renomear tabelas, FKs, índices, policies, funções, tipos, webhooks e consultas numa única entrega aumenta o risco sem benefício funcional. O código expõe aliases `Company` e `CompanyRole` para novas funcionalidades; o adaptador atual continua entendendo o schema legado.

Uma futura migration física só deve ser considerada com janela de manutenção, views de compatibilidade, regeneração de tipos e validação de todos os consumidores externos.

## Decisão sobre primeira instalação

O modelo é híbrido:

1. O operador configura Supabase e segredos no host antes do build/deploy.
2. As migrations preparam banco e RLS.
3. O primeiro usuário autenticado abre `/setup` e apresenta `SETUP_SECRET`.
4. Uma função acessível apenas ao servidor cria empresa + owner + lock numa transação.
5. `app_installations.singleton` impede nova inicialização, inclusive sob concorrência.

Esta decisão evita enviar service role/Secret key ao navegador, não depende do filesystem do container e funciona em deploy público, self-hosted, serverless ou com múltiplas instâncias.
