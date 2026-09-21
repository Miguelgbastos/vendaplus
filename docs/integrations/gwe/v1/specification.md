# GWE CRM Lead Snapshot v1

**Status:** Normativo para implementação  
**Schema:** `gwe.crm.lead`  
**Versão:** `1`

## Objetivo

GWE é o protocolo de integração para snapshots completos de leads enviados por
CRMs ou middlewares. Não é o modelo de domínio interno do Venda+. O adaptador
converte os marcadores wire `"1"` em valores tipados antes da reconciliação.

## Endpoint e segurança

Integrações GWE usam:

```http
POST /api/v1/webhooks/crm/{endpoint_id}
Content-Type: application/json
X-GWE-Timestamp: <unix seconds>
X-GWE-Key-Id: <key id>
X-GWE-Signature: v1=<hex HMAC-SHA256>
```

O `endpoint_id` é público e não é credencial. `tenant_id`, `connection_id` e
`provider` são derivados do endpoint, nunca aceitos do payload. A assinatura é
calculada sobre `timestamp + "." + raw_body`, exatamente como recebido. A janela
de replay padrão é de 300 segundos.

O `payload_hash` é `SHA-256(JCS(parsed_json))`, usando RFC 8785. A assinatura
protege o transporte; o hash identifica semanticamente o conteúdo.

O corpo deve ser UTF-8 JSON e ter no máximo 1 MiB (1.048.576 bytes). Segredos HMAC são
versionados, criptografados em repouso e podem ter uma chave anterior válida
durante a janela de rotação.

## Snapshot

`event.type` é exclusivamente `lead.snapshot` na v1. O snapshot é a visão
completa e autoritativa da origem em `event.occurred_at`: campos obrigatórios
devem estar presentes, ainda que o valor seja `null`. Campo ausente não é
equivalente a campo nulo.

`current_stage` representa o estado atual GWE. Os milestones são históricos e
cumulativos: `"1"` significa que a etapa já foi atingida; `null` significa não
atingida quando `history_complete=true`, e desconhecida quando
`history_complete=false`. `venda="1"` e `perda="1"` podem coexistir
historicamente. O estágio atual não pode ser dois valores ao mesmo tempo.

`history_complete` informa se a origem conhece todo o histórico. Milestones
internos são monotônicos e nunca são apagados por snapshots posteriores.
`source_entered_at` é o horário informado pela origem; `observed_at` é gerado
pelo Venda+ e não é aceito no payload.

O estado comercial nativo do CRM (`pipeline` e `stage`) é separado do lifecycle
GWE. UTM fica em `attribution`, não nos markers GWE.

## Identidade, ordenação e idempotência

A identidade de um lead é `connection_id + lead.external_id`. A idempotência de
eventos é `connection_id + event.id`. `event.id` é obrigatório e não há fallback
por hash. Se o mesmo ID chegar com o mesmo `payload_hash`, a resposta é
`already_received`; com hash diferente, a resposta é `409 event_id_collision`.

`event.sequence`, quando confiável, é a prioridade de ordenação; na ausência,
usa-se `occurred_at`. Eventos stale podem ser auditados, mas não sobrescrevem o
estado atual. Reconciliações do mesmo lead devem ser serializadas por lock
transacional.

## Processamento

Persistência de `raw_event`, estado de processamento e `processing_outbox`
ocorre em uma única RPC PostgreSQL. O raw event e sua identidade são
imutáveis; tentativas, status e erros ficam em `event_processing`.

O pipeline é at-least-once e deve ser idempotente:

```text
raw event → adapter → CrmLeadSnapshot → lock → reconciliation → domain events
```

Eventos de domínio usam IDs determinísticos próprios por efeito. Integrações
externas, incluindo Meta CAPI, consomem uma integration outbox e não são
disparadas diretamente dentro do reconciler.

## Adapters

O GWE genérico usa HMAC e o contrato acima. Adaptadores nativos de HubSpot,
Pipedrive, RD Station e Kommo usam a autenticidade nativa de cada provedor e
convergem diretamente para `CrmLeadSnapshot`; não precisam fabricar um payload
GWE.

## Retenção e LGPD

Payloads brutos contêm PII e devem ter acesso restrito, não aparecer em logs e
ser retidos por no máximo 90 dias inicialmente. Após expiração, o payload é
removido, mas hash e metadados de processamento podem ser preservados. A
política final de retenção deve ser configurável e auditável.

## Compatibilidade

Mudanças semânticas exigem `schema_version` nova. O servidor não deve adivinhar
versões não suportadas. A v1 usa somente `"1"` ou `null` para milestones e
datas ISO 8601 com timezone obrigatório.
