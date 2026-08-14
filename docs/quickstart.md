# Venda+ funcionando em 15 minutos

Este roteiro entrega o banco aplicado, a aplicação local e o primeiro acesso.
Domínio, deploy permanente, SMTP, Kommo e Meta CAPI ficam para a configuração
completa. O Venda+ já é utilizado em operação real, mas cada instalação deve
validar sua própria infraestrutura e integrações.

## Antes de começar

Tenha Node.js 20.9+, Git, uma conta Supabase e um projeto vazio. Separe a URL,
a Publishable key e a Secret key do projeto.

## 1. Baixe e instale

```bash
git clone https://github.com/Miguelgbastos/vendaplus.git
cd vendaplus
npm ci
cp .env.example .env.local
```

## 2. Configure o ambiente

Preencha em `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
NEXT_PUBLIC_APP_URL=http://localhost:3000
SETUP_SECRET=gere-um-valor-com-pelo-menos-32-caracteres
WORKER_SECRET=gere-outro-valor-com-pelo-menos-32-caracteres
TOKEN_ENCRYPTION_KEY=64-caracteres-hexadecimais
OAUTH_STATE_SECRET=gere-outro-valor-com-pelo-menos-32-caracteres
```

Gere os valores com os comandos apresentados em `.env.example`.

## 3. Aplique e valide o banco

Autentique a CLI uma vez:

```bash
npx supabase login
```

Confirme duas vezes o project ref para reduzir o risco de aplicar migrations no
projeto errado:

```bash
npm run setup:database -- \
  --project-ref SEU_PROJECT_REF \
  --confirm-project SEU_PROJECT_REF
```

O processo termina com `vendaplus_database_ready`. Nenhum dado demonstrativo é
inserido por padrão.

## 4. Inicie e crie a empresa

```bash
npm run dev
```

1. Abra `http://localhost:3000/cadastro` e crie a primeira conta.
2. Acesse `/setup` e informe o `SETUP_SECRET`.
3. Crie a primeira empresa.
4. Remova `SETUP_SECRET` depois da conclusão.

## 5. Opcional: preencha os dashboards

Crie uma empresa separada, por exemplo **Empresa Demonstração**, com slug
`empresa-demonstracao`. Sem conectar Kommo ou Meta nessa empresa, execute:

```bash
npm run demo:seed -- \
  --project-ref SEU_PROJECT_REF \
  --confirm-project SEU_PROJECT_REF \
  --tenant-slug empresa-demonstracao \
  --confirm-demo VENDA_PLUS_DEMO
```

Abra os dashboards Comercial e Marketing. Para remover somente os registros
fictícios, use `npm run demo:clear` com os mesmos argumentos.

## Próximo passo

Para domínio, deploy, worker, SMTP e integrações, continue no
[guia self-hosted completo](installation.md).
