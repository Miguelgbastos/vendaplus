# Venda+

Plataforma multiempresa de analytics de marketing e comercial, com autenticação Supabase e integração Kommo sem n8n.

O projeto foi desenhado para instalação independente: cada operador usa seu
próprio Supabase, servidor, conta Kommo e conjunto de dados Meta. Nenhuma
credencial ou infraestrutura da instalação original é necessária.

> **Status do projeto:** o Venda+ está em desenvolvimento ativo. Antes de usar
> em produção, revise as migrations, configure backups e valide as integrações
> no seu próprio ambiente. O repositório não oferece uma instância compartilhada
> nem credenciais prontas.

## Documentação

- [Guia de instalação self-hosted](docs/installation.md)
- [Manual de uso](docs/user-manual.md)
- [Configuração do Meta Conversions API](docs/meta-capi.md)
- [Checklist para publicar um fork](docs/public-release.md)
- [Arquitetura e decisões técnicas](docs/architecture.md)
- [Como contribuir](CONTRIBUTING.md)
- [Política de segurança](SECURITY.md)
- [Código de conduta](CODE_OF_CONDUCT.md)

## Participar da comunidade

- Use **Issues** para relatar bugs reproduzíveis ou propor funcionalidades.
- Use **Discussions** para dúvidas, ideias abertas e troca de experiências.
- Para contribuir com código, leia o [guia de contribuição](CONTRIBUTING.md) e
  envie um pull request pequeno e focado.
- Vulnerabilidades devem ser relatadas de forma privada conforme a
  [política de segurança](SECURITY.md), nunca em uma issue pública.

## Arquitetura

- Next.js 16 (App Router) e React 19.
- Supabase Auth SSR com cookies, `auth.getClaims()` no servidor e RLS em todas as tabelas públicas.
- Kommo por empresa: credenciais privadas e tokens criptografados no banco; OAuth, webhook e fila isolados por `tenant_id`.
- Menu **Configurações** com Supabase, Kommo, Meta Ads (CAPI), Usuários e Empresas.
- Servidor de conversão Meta Ads (CAPI) por empresa: Pixel ID e Test Event Code armazenados por empresa; Access Token de System User criptografado; mapa evento⇄estágio de qualificação, log auditável e envio assíncrono via outbox transacional.
- Gestão de acesso por empresa: proprietários e administradores adicionam usuários por e-mail, definem papéis e removem vínculos sem compartilhar dados entre empresas.

Na interface e na documentação, o domínio usa **empresa**. O banco preserva `tenants`, `tenant_users` e `tenant_id` por compatibilidade com dados, RLS, webhooks e integrações existentes. Uma troca física desses nomes seria uma migration destrutiva e não agrega isolamento ou segurança.

O inventário técnico detalhado e as decisões estão em [`docs/architecture.md`](docs/architecture.md).

## Configuração do Supabase

As credenciais do Supabase permanecem no ambiente do deploy, não em formulários da aplicação:

- `NEXT_PUBLIC_SUPABASE_URL`: URL do projeto.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: prefira uma Publishable key `sb_publishable_...`; a chave `anon` legada segue compatível.
- `SUPABASE_SECRET_KEY`: prefira uma Secret key `sb_secret_...`, somente no servidor.
- `SUPABASE_SERVICE_ROLE_KEY`: fallback para instalações legadas.

Variáveis `NEXT_PUBLIC_*` são incorporadas ao bundle do navegador no build do Next.js. A chave secreta ignora RLS e deve ficar no cofre do host. Por isso, cadastrar o Supabase após o deploy exigiria um cofre externo, uma API de configuração em runtime e armazenamento persistente compartilhado; um arquivo local criptografado não é seguro ou confiável em serverless, múltiplos containers ou disco efêmero.

## Instalação

1. Copie `.env.example` para `.env.local` e preencha as variáveis.
2. Gere segredos fortes:

```bash
openssl rand -base64 48 # SETUP_SECRET
openssl rand -hex 32    # TOKEN_ENCRYPTION_KEY
openssl rand -base64 48 # OAUTH_STATE_SECRET
```

3. Aplique as migrations em `supabase/migrations/` no projeto correto.
4. Instale e inicie:

```bash
npm install
npm run dev
```

5. Crie a conta do primeiro administrador, abra `/setup`, informe a primeira empresa e `SETUP_SECRET`.
6. A conclusão roda em transação, concede `owner` ao usuário e grava um lock singleton. Novas tentativas recebem conflito. Remova `SETUP_SECRET` do deploy após concluir.
7. Abra **Configurações → Kommo** para conectar a empresa.
8. (Opcional) Abra **Configurações → Meta Ads (CAPI)** para configurar Pixel + Access Token de System User e o mapa de eventos por qualificação.

Em bancos que já possuem empresas, a migration preenche o lock usando a empresa mais antiga, sem alterar ou apagar dados.

## Variáveis adicionais

- `NEXT_PUBLIC_APP_URL`: URL pública; o redirect do Kommo é `{APP_URL}/api/kommo/oauth/callback`.
- `WORKER_SECRET`: protege o processador da fila.
- `TOKEN_ENCRYPTION_KEY`: AES-256-GCM para tokens/segredos Kommo e Access Token do Meta CAPI.
- `OAUTH_STATE_SECRET`: HMAC do estado OAuth.
- `META_GRAPH_API_VERSION`: opcional; versão da Graph API no formato `vNN.N`. Se omitida, usa `v26.0`.

## Segurança

- Publishable/anon somente no cliente; Secret/service role somente no servidor.
- RLS permanece a fronteira de isolamento multiempresa.
- Alterações de acesso usam uma função transacional autenticada; mutações diretas em `tenant_users` são bloqueadas.
- `app_installations` tem RLS sem policies para clientes e acesso apenas pelo servidor.
- A instalação compara `SETUP_SECRET` em tempo constante e usa função transacional com advisory lock.
- Tokens e Secret Key do Kommo nunca retornam ao navegador.
- O Access Token do Meta CAPI é criptografado e nunca retorna ao navegador; Pixel ID e Test Event Code não são tratados como segredos.
- Eventos automáticos do Meta CAPI nunca incluem `test_event_code`; esse código é exclusivo do teste manual.
- `qualification_history` e o job CAPI correspondente são gravados atomicamente pelo banco quando a integração e o mapping estão ativos.

## Verificação

```bash
npm test
npm run lint
npm run build
```

## Licença

O Venda+ é distribuído sob a [GNU Affero General Public License v3.0](LICENSE).
Se você modificar o projeto e disponibilizá-lo como serviço pela rede, deve
oferecer aos usuários desse serviço acesso ao código-fonte correspondente,
conforme os termos da licença.
