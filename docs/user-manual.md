# Manual de uso do Venda+

## Visão geral

O Venda+ centraliza dados comerciais do Kommo, atribuição de marketing,
dashboards multiempresa e eventos de conversão enviados à Meta. Cada registro
pertence a uma empresa (`tenant_id`) e o acesso é protegido por membership e
RLS no Supabase.

## Entrar e selecionar uma empresa

Depois do login, o sistema resolve uma empresa ativa entre os vínculos do
usuário. Quem participa de mais de uma empresa pode trocar a seleção em
**Configurações → Empresas**. A troca não concede acesso: o servidor valida o
membership antes de aceitar a nova empresa ativa.

## Papéis e permissões

| Papel | Acesso principal |
|---|---|
| Proprietário (`owner`) | Administração completa, inclusive outros proprietários |
| Administrador (`admin`) | Configurações e usuários, sem promover/remover proprietários |
| Analista (`analyst`) | Consulta operacional e dashboards |
| Leitor (`viewer`) | Visualização permitida pelas telas e RLS |

O último proprietário de uma empresa não pode ser removido ou rebaixado.

## Dashboard de Marketing

Use o dashboard para analisar origem, campanha, mídia e evolução dos leads. Os
filtros de data seguem `first_seen_at`, alinhado à criação no Kommo quando esse
dado está disponível.

Filtros de campanha, origem, mídia e responsável são combinados. Limpar um
filtro restaura a visão da empresa ativa, não a visão de outras empresas.

## Dashboard Comercial

O painel comercial acompanha qualificações, resultados, perdas, tempo por
etapa e fechamentos. Métricas de venda/perda podem usar a data de fechamento do
Kommo; portanto, um resultado fechado no período pode ter sido criado antes do
intervalo selecionado.

## Configurações → Supabase

Esta tela apresenta diagnóstico sem revelar chaves. As credenciais Supabase são
configuradas no servidor, não pela interface.

## Configurações → Kommo

Somente proprietário ou administrador pode cadastrar a integração.

1. informe o subdomínio HTTPS exato da conta Kommo;
2. informe `integration_id` e Secret Key da integração privada;
3. inicie o OAuth;
4. autorize a conta correta;
5. configure o webhook gerado pelo Venda+ no Kommo;
6. valide uma atualização real de lead.

Credenciais e tokens são criptografados. O worker precisa estar ativo para
normalizar os eventos recebidos e atualizar os dashboards.

## Configurações → Meta CAPI

Consulte [o guia dedicado](meta-capi.md). A tela permite:

- salvar Dataset/Pixel ID e Access Token por empresa;
- ativar ou desligar o envio automático;
- testar a conexão;
- mapear as sete qualificações para eventos Meta;
- consultar os dez envios mais recentes.

## Configurações → Usuários

Proprietários e administradores adicionam usuários pelo e-mail da conta
Supabase. O usuário precisa possuir identidade válida no Auth. Mudanças de papel
são transacionais e auditáveis pelo banco.

## Configurações → Empresas

Permite criar uma empresa e alternar a empresa ativa. Criar uma empresa concede
ao criador o papel de proprietário. Dados, integrações e credenciais não são
compartilhados entre empresas.

## Operação diária

Verifique regularmente:

- última sincronização do Kommo;
- jobs pendentes ou com erro;
- último envio e último erro do Meta CAPI;
- execuções da tarefa `Venda Worker`;
- diagnósticos do Supabase e do Events Manager;
- qualidade da correspondência dos eventos Meta.

## Solução rápida de problemas

### Dashboards vazios

- confirme a empresa ativa;
- amplie o período;
- remova filtros opcionais;
- confirme webhook, worker e conexão Kommo;
- verifique se os leads pertencem ao `tenant_id` correto.

### Webhook chega, mas os dados não mudam

- confirme que `Venda Worker` executou após o webhook;
- procure jobs `pending`, `processing` ou `failed`;
- valide tokens Kommo e limites da API;
- não reenvie eventos manualmente sem verificar a fila.

### Meta aceita o teste, mas a Visão geral não atualiza

- selecione um intervalo que inclua o `event_time` original;
- aguarde a consolidação do Events Manager;
- confirme que o evento aparece como `sent`, HTTP 200 e com `fbtrace_id` no
  Venda+;
- diferencie a checklist genérica de CAPI Web do guia específico de CAPI CRM.

### Falha ao descriptografar credenciais

Confirme se `TOKEN_ENCRYPTION_KEY` é a mesma usada quando o token foi salvo. Não
substitua a chave para “testar”: isso invalida todos os segredos já cifrados.
