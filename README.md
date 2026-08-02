# Venda+

Plataforma multiempresa de analytics de marketing e comercial, com autenticação Supabase e integração Kommo sem n8n.

## Arquitetura

- Next.js 16 (App Router) e React 19.
- Supabase Auth SSR com cookies, `auth.getClaims()` no servidor e RLS em todas as tabelas públicas.
- Kommo por empresa: credenciais privadas e tokens criptografados no banco; OAuth, webhook e fila isolados por `tenant_id`.
- Menu **Configurações** com Supabase, Kommo, Usuários e Empresas.

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

Em bancos que já possuem empresas, a migration preenche o lock usando a empresa mais antiga, sem alterar ou apagar dados.

## Variáveis adicionais

- `NEXT_PUBLIC_APP_URL`: URL pública; o redirect do Kommo é `{APP_URL}/api/kommo/oauth/callback`.
- `WORKER_SECRET`: protege o processador da fila.
- `TOKEN_ENCRYPTION_KEY`: AES-256-GCM para credenciais Kommo.
- `OAUTH_STATE_SECRET`: HMAC do estado OAuth.

## Segurança

- Publishable/anon somente no cliente; Secret/service role somente no servidor.
- RLS permanece a fronteira de isolamento multiempresa.
- `app_installations` tem RLS sem policies para clientes e acesso apenas pelo servidor.
- A instalação compara `SETUP_SECRET` em tempo constante e usa função transacional com advisory lock.
- Tokens e Secret Key do Kommo nunca retornam ao navegador.
- Credenciais Kommo são isoladas por empresa e o worker exige segredo próprio.

## Verificação

```bash
npm test
npm run lint
npm run build
```
