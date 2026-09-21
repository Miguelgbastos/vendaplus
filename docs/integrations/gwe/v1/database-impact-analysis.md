# GWE v1 — Database Compatibility Audit

**Status:** análise somente leitura; nenhuma migration acompanha este documento  
**Base analisada:** migrations Supabase existentes, funções SQL, RLS e fluxo
runtime atual do Kommo/Meta CAPI

## 1. Current Architecture

### Ingestão Kommo

O endpoint atual é `POST /api/webhooks/kommo/[token]`. Ele:

1. resolve `webhook_endpoints` pelo token;
2. limita requisições e interpreta JSON, form-urlencoded ou multipart;
3. extrai tipo, leads e chave de idempotência;
4. chama a RPC `enqueue_kommo_webhook_event`;
5. agenda `runKommoWorker` em `after()`.

A RPC insere `raw_events` e `jobs` na mesma transação PostgreSQL. A rota não
envia `tenant_id` arbitrário para a consulta: ele vem do endpoint encontrado,
mas a RPC atual recebe `p_tenant_id` e `p_webhook_endpoint_id` como argumentos
confiados pelo caller service-role. A futura RPC GWE deve resolver e validar
endpoint → connection → tenant internamente, sem receber esses IDs como
autoridade externa.

### Fila e worker

`public.jobs` é a fila operacional existente. `public.claim_jobs` usa
`FOR UPDATE SKIP LOCKED`, lease, tentativas, prioridade e filtros por tipo e
tenant. `runKommoWorker` consome atualmente:

```text
process_kommo_event
send_meta_capi_event
```

O mecanismo já suporta retry, lease expirado, replay de jobs mortos e
isolamento por tenant. Criar uma segunda fila paralela para `processing_outbox`
seria desnecessário no primeiro desenho; uma outbox específica pode publicar
jobs nesta fila existente, desde que suas responsabilidades sejam explicitadas.

### Sincronização Kommo

`public.sync_kommo_lead_state` executa a sincronização de lead, contato,
`qualification_history` e `stage_history` em uma transação. A função usa
`pg_advisory_xact_lock(hashtext(tenant_id), hashtext(kommo_lead_id))` e bloqueia
a linha de `leads` com `FOR UPDATE`. Esse é o precedente existente para
serialização por lead.

### Meta CAPI

O fluxo atual é:

```text
sync_kommo_lead_state
  → INSERT qualification_history
  → trigger qualification_history_enqueue_meta_capi
  → INSERT jobs(send_meta_capi_event)
  → runKommoWorker
  → processMetaCapiJob
  → Meta Graph API
```

O trigger `private.enqueue_meta_capi_from_qualification_history` é o único
disparo SQL identificado para o job Meta. Ele gera `event_id = 'qh-' ||
qualification_history.id` e existe um índice único parcial sobre
`jobs.payload ->> 'event_id'`.

**Implicação crítica:** uma futura integration outbox que também publique Meta
CAPI não pode ser adicionada em paralelo a esse trigger sem uma decisão de
substituição/adaptação. Caso contrário, a mesma transição poderá gerar dois
jobs Meta.

## 2. Reusable Structures

| Estrutura atual | Ação recomendada | Justificativa |
| --- | --- | --- |
| `leads` | ALTER incremental | Já é o snapshot operacional, possui FK tenant, RLS, índices e unique Kommo. Precisa suportar identidade por conexão e metadados de ordenação. |
| `qualification_history` | REUSE + ALTER | Já é append-oriented, alimenta dashboards e Meta CAPI, mas não possui `source_event_id`, `domain_event_id` ou semântica explícita de snapshot/milestone. |
| `stage_history` | REUSE + ALTER | Já registra mudanças de pipeline/status; pode receber provider/connection/source event para eventos não-Kommo. |
| `jobs` | REUSE | Já possui claim concorrente, lease, retry, prioridade, dead jobs e unique por raw event/tipo. Adicionar novos `job_type` é preferível a criar worker de fila paralelo. |
| `raw_events` | ALTER | Já é evidência bruta multi-tenant e possui idempotência tenant/provider/key. Precisa de connection, payload hash, safe headers e separação do estado de processamento. |
| `webhook_endpoints` | ALTER controlado | Hoje é 1 endpoint por tenant, token em plaintext, exclusivo na prática do Kommo. Precisa evoluir sem quebrar a rota legada. |
| `kommo_connections` | REUSE para Kommo | Continua sendo a conexão nativa Kommo; não deve virar implicitamente o modelo de todos os CRMs. |
| RLS de leads/history/jobs/raw | EXTEND | As políticas atuais são tenant-based; novas entidades devem derivar tenant pela conexão/endpoint e preservar o isolamento existente. |
| `claim_jobs` | REUSE + novos tipos | O lease atual cobre o dispatcher. Alteração só se novos estados/outcomes exigirem. |
| `sync_kommo_lead_state` | KEEP durante migração | É atomicamente correto para o Kommo e já possui lock. Criar adaptador genérico antes de retirar esse contrato. |
| trigger Meta CAPI | ADAPT/REPLACE posteriormente | É funcional, mas conflita com a integration outbox proposta. Não duplicar o disparo. |

## 3. Required Changes

### 3.1 Identidade e snapshot em `leads`

O schema atual possui:

```text
tenant_id
kommo_lead_id
pipeline_id
status_id
status_name
qualification
utm_*
raw
```

e `UNIQUE (tenant_id, kommo_lead_id)`. Não existem `provider`,
`connection_id`, `external_lead_id`, `last_source_event_at` ou
`last_source_sequence`.

Para GWE, a chave lógica precisa ser:

```text
connection_id + external_lead_id
```

O PR 2 deve decidir entre:

1. adicionar `connection_id` e `external_lead_id`, mantendo `kommo_lead_id`
   temporariamente para compatibilidade; ou
2. criar uma tabela de snapshots CRM separada e manter `leads` como projeção
   legada.

A opção 1 é menor, mas exige backfill de todas as linhas Kommo:

```text
connection_id = conexão Kommo do tenant
external_lead_id = kommo_lead_id
```

Também serão necessários metadados de ordenação:

```text
last_source_event_at
last_source_sequence
last_source_event_id
```

Não deve existir uma unique nova até que duplicidades e valores nulos
existentes sejam auditados.

### 3.2 `qualification_history`

A tabela atual registra:

```text
lead_id
from_qualification
to_qualification
source
changed_at
metadata
```

Não tem unique de transição/evento e não guarda `source_event_id`. O trigger
Meta dispara para cada insert. O PR 2 deve acrescentar uma identidade
idempotente antes de permitir que snapshots gerem efeitos:

```text
source_event_id
domain_event_id ou effect_id
connection_id
```

Uma unique deve ser desenhada para permitir reabertura legítima (perda e venda
podem coexistir historicamente) sem permitir que o retry do mesmo evento crie a
mesma transição outra vez.

### 3.3 `raw_events` e processamento

O schema atual já possui `raw_events`, porém:

- `provider` defaulta para `kommo`;
- a idempotência é `(tenant_id, provider, idempotency_key)`;
- `headers` é genérico e não expressamente allowlisted;
- não há `payload_hash`;
- `processed_at` mistura conteúdo do evento com estado de processamento;
- `webhook_endpoint_id` pode ser nulo;
- não existe `connection_id`.

O PR 2 deve escolher entre alterar a tabela atual e criar uma camada de
compatibilidade. A recomendação é manter a linha de evento como identidade e
payload imutáveis, adicionando uma tabela `event_processing` para status,
tentativas, leases e erro. O job existente pode continuar sendo o executor,
com uma outbox/dispatcher transacional apontando para ele.

### 3.4 `webhook_endpoints`

Hoje há uma única linha por tenant (`UNIQUE tenant_id`), token único em
plaintext, sem provider, connection, key version, rotação ou timestamps de
recebimento. O OAuth callback Kommo cria o endpoint e a página Kommo lê o token.

PR 2 deve:

- remover ou substituir a restrição de um endpoint por tenant somente quando a
  compatibilidade da rota Kommo estiver coberta;
- introduzir `connection_id` ou uma relação equivalente;
- preservar token legado para a rota Kommo durante a migração;
- adicionar identificador público separado do segredo;
- criar `webhook_signing_keys` para segredos HMAC versionados;
- adicionar status/uso operacional sem armazenar segredos nos headers.

Ainda não há evidência suficiente para afirmar que duas tabelas são obrigatórias
no v1. A separação `crm_connections` + `webhook_endpoints` é compatível com o
roadmap, mas deve começar com `UNIQUE(connection_id)` se houver um endpoint por
conexão no primeiro release.

### 3.5 RPC transacional de ingestão

A função futura deve ser equivalente a:

```text
ingest_crm_webhook_event(
  p_endpoint_public_id,
  p_external_event_id,
  p_event_type,
  p_payload,
  p_payload_hash,
  p_safe_headers,
  p_occurred_at
)
```

Ela deve:

1. resolver endpoint, conexão e tenant internamente;
2. validar endpoint ativo e idempotência;
3. comparar `event_id` existente com `payload_hash`;
4. inserir `raw_events`;
5. inserir `event_processing`;
6. inserir o registro de dispatch/outbox;
7. fazer tudo em uma transação;
8. devolver `accepted`, `already_received` ou `event_id_collision`.

Não deve aceitar `tenant_id`, `connection_id` ou `provider` como autoridade da
requisição HTTP.

### 3.6 Concorrência

O mecanismo existente `private.lock_tenant_lead` usa dois hashes:

```text
tenant_id + kommo_lead_id
```

Para GWE, a chave deve evoluir para:

```text
connection_id + external_lead_id
```

O PR 2 deve preferir estender o helper existente ou criar um helper equivalente
com a mesma convenção, em vez de introduzir lock distribuído novo. Deve também
considerar colisão de `hashtext`; se a implementação depender de advisory lock,
o identificador composto precisa ser estável e documentado.

## 4. Risks and Conflicts

### Meta CAPI — bloqueador

O trigger `qualification_history_enqueue_meta_capi` cria diretamente
`send_meta_capi_event`. O novo pipeline de domain/integration outbox não pode
também criar esse job para a mesma transição.

Decisão recomendada para o PR 5:

```text
Meta CAPI legado: ADAPT
```

Durante a migração, manter o trigger como único produtor de Meta CAPI e fazer o
novo reconciler inserir `qualification_history` com uma identidade
idempotente. Depois, mover a responsabilidade para a integration outbox em uma
migration separada, desativando o trigger somente quando a equivalência de
event_id, retry e deduplicação estiver testada.

### Duplicidade entre raw event e job

A RPC Kommo atual é transacional para raw event + job e o índice
`jobs_raw_event_type_unique` já evita job duplicado por evento/tipo. O novo
dispatcher deve reutilizar essa garantia ou substituí-la por uma constraint
equivalente; não inserir jobs pelo client em chamadas separadas.

### Identidade legada

`contacts` e `leads` também têm uniques baseadas em IDs Kommo. Uma migração
in-place pode colidir com o modelo multi-connection. Backfill e estratégia para
nulos precisam ser definidos antes de alterar constraints.

### RLS e funções SECURITY DEFINER

As funções privilegiadas usam `set search_path = ''` e grants explícitos. A RPC
nova deve seguir esse padrão. As tabelas atuais possuem RLS tenant-based, mas
endpoints e segredos exigirão policies diferentes: membros não devem ler
segredos HMAC; owner/admin devem administrar endpoints; o webhook público deve
operar somente via função `service_role`.

### Retenção de PII

`raw_events.payload` pode conter nome, telefone, e-mail, UTM e valor. A tabela
atual não possui expiração. O PR 2 deve definir retenção/limpeza sem apagar
metadados necessários à idempotência ou auditoria.

### Ordenação

O schema atual não guarda sequência/evento de origem em `leads` nem em
`qualification_history`. Sem novos campos, eventos stale podem sobrescrever o
estado. A ordenação deve ser persistida junto ao snapshot antes de habilitar
workers GWE concorrentes.

### Outbox duplicada

Já existe o padrão de outbox implementado como `jobs` e trigger de Meta. Criar
`processing_outbox` e `integration_outbox` sem definir qual camada publica em
`jobs` pode gerar duas filas e duas tentativas para o mesmo efeito. O desenho
recomendado é:

```text
ingest RPC → raw/event_processing + dispatch outbox
dispatch outbox → jobs(process_crm_event)
reconciler → qualification_history/domain effect
Meta trigger legado → jobs(send_meta_capi_event), temporariamente
```

## 5. Proposed PR 2 Schema

O schema abaixo é uma proposta de impacto, não SQL executável.

### Tables to CREATE

```text
crm_connections
webhook_signing_keys
event_processing
```

`webhook_endpoints` pode permanecer existente e ser alterada para referenciar
`crm_connections`. Um `processing_outbox` separado só deve ser criado se o
dispatcher não puder reutilizar `jobs` com segurança.

### Tables to ALTER

```text
webhook_endpoints
raw_events
leads
qualification_history
stage_history
jobs
```

Alterações exatas dependem do resultado do backfill e da decisão de preservar
`kommo_lead_id` como alias legado.

### Tables to REUSE unchanged

```text
contacts
meta_capi_connections
meta_capi_event_mappings
meta_capi_events
tenant_users
```

`contacts` só deve ser alterada se o domínio passar a exigir contatos
multi-connection; isso não é requisito mínimo da ingestão GWE v1.

### Functions to CREATE

```text
ingest_crm_webhook_event(...)
lock_connection_lead(...)
```

Possivelmente uma função de backfill/validação, mas ela não deve ser misturada à
RPC pública de ingestão.

### Functions to ALTER

```text
claim_jobs(...)
sync_kommo_lead_state(...)
```

`claim_jobs` só se novos tipos/outcomes exigirem. `sync_kommo_lead_state` deve
permanecer compatível até o Kommo migrar para o pipeline comum.

### Triggers affected

```text
qualification_history_enqueue_meta_capi
```

Decisão recomendada: **KEEP temporariamente; ADAPT na migração para integration
outbox; REPLACE somente após testes de não duplicidade**.

Triggers de `updated_at` podem ser reutilizados nas tabelas alteradas.

### RLS policies affected

```text
raw_events
webhook_endpoints
leads
qualification_history
event_processing
crm_connections
webhook_signing_keys
```

Segredos e payloads brutos devem ser acessíveis apenas por service-role ou por
owner/admin em telas explicitamente autorizadas. O endpoint público não deve
usar RLS de usuário; deve usar RPC SECURITY DEFINER com grants mínimos.

### Indexes affected

```text
raw_events (connection_id, external_event_id) UNIQUE
raw_events payload_hash lookup/support index, se necessário
leads (connection_id, external_lead_id) UNIQUE
qualification_history (source_event_id, transition/effect identity) UNIQUE
jobs (raw_event_id, job_type) UNIQUE — reutilizar
```

Os índices atuais de tenant, qualification, status, UTM e datas devem ser
mantidos enquanto os dashboards ainda consultarem essas colunas.

### Backfill required

**Provavelmente YES**, se `leads` for evoluída in-place:

```text
Kommo connection por tenant
kommo_lead_id → external_lead_id
```

Antes do backfill é necessário verificar tenants sem conexão Kommo, leads com
`kommo_lead_id` nulo e qualquer duplicidade existente.

### Breaking migration

**NO na primeira etapa**, desde que:

- a rota Kommo e a RPC antiga permaneçam compatíveis;
- colunas legadas não sejam removidas;
- constraints antigas só sejam removidas após backfill/verificação;
- o trigger Meta não seja desativado antes da migração de efeitos;
- novas colunas aceitem o estado legado durante a transição.

### Rollback

O rollback deve ser feito somente por migration operacional revisada, nunca por
remoção manual de dados legados. Os objetos exclusivos do PR 2 são:

```text
crm_connections
webhook_signing_keys
event_processing
processing_outbox
```

As colunas e índices aditivos em `webhook_endpoints`, `raw_events`, `leads`,
`qualification_history` e `stage_history` devem ser removidos somente depois de
confirmar que não existem conexões GWE, eventos processados ou referências
ativas. O rollback não deve remover nem reescrever linhas Kommo, jobs legados,
histórico de qualificação ou payloads existentes. A função
`ingest_crm_webhook_event` pode ser revogada/removida sem alterar
`enqueue_kommo_webhook_event`, `sync_kommo_lead_state` ou o trigger Meta CAPI.

## Próximos gates

Antes de escrever a migration do PR 2, ainda é necessário:

1. confirmar o conteúdo da migration Meta CAPI completa e seus grants;
2. executar auditoria de dados no ambiente alvo para nulidade/duplicidade;
3. decidir in-place versus tabela de snapshot/projeção para `leads`;
4. desenhar a RPC transacional e sua matriz de retornos;
5. definir se `jobs` será o dispatcher final ou se haverá outbox adicional;
6. especificar a tabela de chaves HMAC e sua RLS;
7. escrever plano de backfill e rollback.
