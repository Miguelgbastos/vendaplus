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

- Supabase Auth mantém a identidade; `profiles` espelha e-mail de `auth.users` (não editável pelo client).
- `tenant_users` representa membership com `owner`, `admin`, `analyst` e `viewer`.
- Após o setup, o cadastro é invite-only (`tenant_invites` + `inviteUserByEmail` no servidor).
- Usuário já existente recebe membership imediata; o e-mail é resolvido em `auth.users`.
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

- `meta_capi_connections`: Pixel ID, Test Event Code e Access Token de System User por `tenant_id`. Somente o Access Token é criptografado com AES-256-GCM via `TOKEN_ENCRYPTION_KEY`; `access_token_encrypted` fica restrito ao `service_role`.
- `meta_capi_event_mappings`: mapa `qualification → event_name` (Lead, Purchase, InitiateCheckout, ...). Owner/admin edita nomes, moeda, ativo/inativo e se envia `value` do lead. Os defaults são persistidos na primeira configuração.
- `meta_capi_events`: log auditável dos envios (`event_id`, HTTP status, `fbtrace_id`). PII de `user_data` é enviada hasheada em SHA-256; o log também remove IP, user-agent, URL de origem e `content_name` por defesa em profundidade.
- Transactional outbox: um trigger `AFTER INSERT` em `qualification_history` verifica conexão + mapping ativos e cria `send_meta_capi_event` na mesma transação PostgreSQL. O `event_id` é `qh-{qualification_history.id}`, portanto permanece estável em qualquer retry e é protegido por índice único na fila.
- Jobs CAPI usam prioridade 200, abaixo dos jobs Kommo (100), e reaproveitam o retry exponencial existente para 5xx/429/rede.
- `test_event_code` é exclusivo do fluxo manual de teste e nunca acompanha os eventos automáticos de produção.
- O client da Graph API possui timeout de 10 segundos. A versão padrão permanece `v20.0` por compatibilidade e pode ser atualizada via `META_GRAPH_API_VERSION`.

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
