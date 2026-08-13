# Instalação self-hosted do Venda+

Este guia cria uma instalação isolada do Venda+. Cada instalação possui seu
próprio banco Supabase, domínio, servidor de aplicação, integrações Kommo e
servidor Meta Conversions API (CAPI).

## 1. Pré-requisitos

- Node.js 20.9 ou superior (preferencialmente uma versão LTS) e npm;
- uma conta e um projeto Supabase;
- um servidor ou plataforma que execute aplicações Next.js persistentes;
- domínio HTTPS público;
- Git e acesso ao repositório;
- opcionalmente, uma conta Kommo e um Business Manager da Meta.

O Venda+ pode ser hospedado em Coolify, Docker ou outro provedor compatível com
Next.js. Os exemplos de produção usam Coolify, mas o contrato de execução é
apenas `npm install`, `npm run build` e `npm start` na porta 3000.

## 2. Clonar e validar localmente

```bash
git clone URL_DO_SEU_REPOSITORIO vendaplus
cd vendaplus
npm ci
cp .env.example .env.local
```

Antes do primeiro deploy:

```bash
npm test
npm run build
```

## 3. Criar o projeto Supabase

Crie um projeto vazio e guarde:

- Project URL;
- Publishable key (`sb_publishable_...`) ou chave `anon` legada;
- Secret key (`sb_secret_...`) ou `service_role` legada.

A Secret/service role ignora RLS. Ela deve existir somente no ambiente do
servidor e nunca pode usar o prefixo `NEXT_PUBLIC_`.

### Aplicar o banco

Confirme o identificador do projeto antes de executar SQL. Aplique, em ordem,
todos os arquivos de `supabase/migrations/`. Para uma instalação nova, não pule
arquivos nem aplique somente a migration mais recente.

Com a Supabase CLI autenticada:

```bash
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

A migration `20260731170000_dashboard_filter_indexes.sql` usa `create index if
not exists` (sem `CONCURRENTLY`) e é idempotente se os índices já existirem em
`0001_initial.sql`.

Para auth, convites e SMTP, veja também `docs/auth-invites-smtp.md`.

Depois, confirme no Supabase:

- todas as migrations aparecem no histórico;
- as tabelas públicas têm RLS habilitado;
- existem `tenants`, `tenant_users`, `jobs`, `qualification_history` e as três
  tabelas `meta_capi_*`;
- o trigger `qualification_history_enqueue_meta_capi` está ativo.

## 4. Configurar variáveis

Gere valores diferentes para cada instalação:

```bash
openssl rand -base64 48 # SETUP_SECRET
openssl rand -base64 48 # WORKER_SECRET
openssl rand -hex 32    # TOKEN_ENCRYPTION_KEY
openssl rand -base64 48 # OAUTH_STATE_SECRET
```

Configure:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
NEXT_PUBLIC_APP_URL=https://vendas.seudominio.com
SETUP_SECRET=...
WORKER_SECRET=...
TOKEN_ENCRYPTION_KEY=... # exatamente 64 caracteres hexadecimais
OAUTH_STATE_SECRET=...
META_GRAPH_API_VERSION=v26.0
```

Use `SUPABASE_SERVICE_ROLE_KEY` apenas quando o projeto ainda não oferecer uma
Secret key. Variáveis `NEXT_PUBLIC_*` são incorporadas no build; alterá-las
exige um novo build/deploy.

## 5. Publicar no Coolify

1. Crie uma aplicação a partir do repositório Git.
2. Selecione Nixpacks e exponha a porta `3000`.
3. Cadastre todas as variáveis como disponíveis em runtime. Marque também como
   build-time apenas as variáveis `NEXT_PUBLIC_*`.
4. Configure o domínio HTTPS.
5. Faça o deploy e confirme que `/login` responde.

O deploy só está validado quando o container está `Running`, o build terminou
sem erro e a URL pública abre a versão esperada.

## 6. Criar o primeiro proprietário

1. Acesse `/cadastro` e crie a primeira conta.
2. Abra `/setup` autenticado.
3. Informe o nome da primeira empresa e o `SETUP_SECRET`.
4. Confirme a criação.
5. Remova `SETUP_SECRET` do ambiente e reinicie a aplicação.

O setup é de uso único. O banco registra um lock e rejeita novas tentativas.

## 7. Ativar o worker

Webhooks e mudanças de qualificação criam jobs transacionais. Eles não são
enviados às integrações enquanto o worker não executar.

No Coolify, em **Scheduled Tasks**, crie:

- nome: `Venda Worker`;
- frequência: `* * * * *`;
- timeout: `300` segundos;
- comando:

```bash
node -e 'fetch("https://SEU-DOMINIO/api/workers/process",{method:"POST",headers:{authorization:"Bearer "+process.env.WORKER_SECRET}}).then(r=>{if(!r.ok)throw Error(r.status)})'
```

O endpoint processa 10 jobs por chamada por padrão. O worker é compartilhado
entre Kommo e Meta CAPI e respeita prioridade, tentativas e backoff da fila.

Valide a tarefa com **Execute Now** e confirme uma execução `Success`.

## 8. Configuração final

Na aplicação:

1. abra **Configurações → Supabase** e confirme o diagnóstico;
2. conecte o Kommo em **Configurações → Kommo**;
3. configure a Meta em **Configurações → Meta CAPI**;
4. cadastre membros em **Configurações → Usuários**;
5. confirme os dashboards de Marketing e Comercial.

Consulte os guias específicos antes de ativar integrações em produção.

## Atualizações

Antes de atualizar uma instalação:

1. faça backup do banco;
2. leia migrations e notas da versão;
3. aplique migrations no projeto correto;
4. publique o novo commit;
5. rode testes e verifique login, dashboards, webhook e worker.

Nunca troque `TOKEN_ENCRYPTION_KEY` em uma instalação com credenciais gravadas
sem antes criar um processo de rotação. Tokens existentes deixariam de poder ser
descriptografados.
