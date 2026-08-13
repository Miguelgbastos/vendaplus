# Meta Conversions API por empresa

## O que o Venda+ envia

O Venda+ envia mudanças de qualificação do CRM diretamente ao Dataset/Pixel da
empresa. O fluxo usa `action_source=system_generated`, `event_source=crm` e
`lead_event_source=Kommo`.

Defaults:

| Qualificação | Evento Meta | Valor padrão |
|---|---|---|
| MQL | `Lead` | não |
| SAL | `Lead` | não |
| SQL | `QualifiedLead` | não |
| Oportunidade | `InitiateCheckout` | não |
| Negociação | `AddPaymentInfo` | sim |
| Venda | `Purchase` | sim |
| Perda | `LostLead` | desativado na primeira configuração |

Proprietário e administrador podem alterar os nomes e ativar/desativar cada
linha. Eventos automáticos não usam `test_event_code`.

## Pré-requisitos na Meta

- Business Manager com acesso ao conjunto de dados;
- Dataset/Pixel pertencente à empresa correta;
- System User com acesso ao ativo;
- Access Token com permissão para enviar eventos;
- formulário/CRM preservando o `lead_id` Meta quando disponível.

O Dataset ID é o mesmo identificador exibido no Events Manager. Não confunda
com conta de anúncios, Business ID ou outro Pixel da mesma empresa.

## Configurar no Venda+

1. Selecione a empresa correta.
2. Abra **Configurações → Meta CAPI**.
3. Informe Dataset/Pixel ID e Access Token.
4. Deixe o envio automático desligado durante a configuração inicial.
5. Salve os sete mapeamentos.
6. No Events Manager, abra **Eventos de teste** e copie o Test Event Code.
7. Informe-o somente na área de teste do Venda+ e envie um evento sintético.
8. Confirme HTTP 200 e `events_received: 1`.
9. Remova o Test Event Code salvo se não precisar de novos testes.
10. Ative o envio automático.

## CAPI Web versus CAPI CRM

O Events Manager oferece uma checklist genérica para eventos do site, com
`action_source=website`, `PageView`, `ViewContent`, `Search` e outros. Ela não é
o fluxo do servidor CRM do Venda+ e não precisa ser concluída para esta
integração.

Para campanhas de Conversion Leads, use o guia de integração CRM. A Meta pode
solicitar um lead de verificação e a escolha do estágio usado para otimização.
Essa etapa comercial é separada da aceitação técnica da API.

## Identificação e privacidade

Email, telefone, nome e identificadores permitidos são normalizados e
convertidos em SHA-256 antes do envio. `fbc`, `fbp` e o `lead_id` Meta são
enviados sem hash quando disponíveis, conforme o contrato da Meta.

O Access Token é cifrado com AES-256-GCM. Logs não armazenam IP, user-agent,
URL de origem ou nome de conteúdo. Nunca cole tokens em issues, commits, logs ou
capturas públicas.

## Fila e idempotência

Uma inserção em `qualification_history` cria o job CAPI na mesma transação. O
identificador é `qh-{qualification_history.id}` e possui unicidade na fila.
Retries reutilizam o mesmo `event_id`, permitindo deduplicação na Meta.

O worker deve executar continuamente. Sem ele, eventos ficam `pending` e não
chegam à Meta.

## Backfill

A Meta rejeita eventos cujo `event_time` seja mais antigo que sete dias. Um
backfill deve:

- selecionar somente históricos dentro da janela aceita;
- considerar apenas mapeamentos ativos;
- preservar o horário real da transição;
- usar o `event_id` determinístico do histórico;
- excluir históricos que já tenham job ou log CAPI;
- processar em lotes controlados e auditar HTTP, erro e `fbtrace_id`.

Não altere qualificações reais de leads apenas para gerar um backfill.

## Critérios de aceite

Uma integração está operacional quando:

- conexão e envio automático estão ativos;
- os sete mapeamentos foram persistidos;
- o teste retorna HTTP 200 e `events_received` positivo;
- o worker possui execução recente com sucesso;
- um evento real conclui em `sent`, HTTP 200 e `fbtrace_id` preenchido;
- não há crescimento contínuo de jobs pendentes ou falhos.

O HTTP 200 confirma recebimento pela API, mas a consolidação na Visão geral do
Events Manager pode levar algum tempo e respeita o `event_time`, não o horário
do upload.
