# Auth, convites e SMTP (self-hosted)

## Modelo de acesso

1. **Antes do primeiro setup** (`app_installations` vazio): `/cadastro` permanece aberto para criar o operador inicial.
2. **Depois do setup**: o cadastro aberto redireciona para login (`signup=invite_only`). O link de cadastro é ocultado nesse estado para não criar um fluxo circular.
3. **Criação administrativa**: um owner/admin informa nome, e-mail, senha inicial e papel. O servidor usa `auth.admin.createUser`, confirma o e-mail e vincula a identidade à empresa com `manage_company_user`; a chave `service_role` nunca chega ao navegador.
4. **Usuário já existente** (mesmo e-mail em `auth.users`): o admin adiciona membership imediatamente via `manage_company_user`; a senha existente não é alterada.
5. **Convites legados** continuam aceitos pelo fluxo `tenant_invites`; sua autorização usa apenas `token_hash` + `auth.users.email` + `auth.uid()`.

## Redirect URLs no Supabase Auth

Configure em Authentication → URL Configuration:

| Tipo | Valor |
|------|--------|
| Site URL | `NEXT_PUBLIC_APP_URL` (ex.: `https://app.seudominio.com`) |
| Redirect URLs | `https://app.seudominio.com/api/auth/callback` |
| | `https://app.seudominio.com/api/auth/callback?next=/redefinir-senha` |
| | `https://app.seudominio.com/api/auth/callback?next=/convite` |
| | `https://app.seudominio.com/convite` |

O callback da aplicação só aceita `next` **interno** (`safeInternalPath`).

## SMTP e templates

Para convites e recuperação de senha em produção:

1. Authentication → SMTP: host, porta, usuário, senha e remetente.
2. Templates → Invite / Reset password: mantenha o link apontando para o fluxo Supabase (`{{ .ConfirmationURL }}`), que deve cair no redirect acima.
3. Opcional: personalize o corpo mencionando “Venda+” e a empresa.

Sem SMTP configurado, `inviteUserByEmail` / `resetPasswordForEmail` falham ou usam o mailer padrão do projeto (limitado).

## Segredos mínimos

| Variável | Mínimo |
|----------|--------|
| `SETUP_SECRET` | 32 caracteres |
| `WORKER_SECRET` | 32 caracteres |
| `OAUTH_STATE_SECRET` | 32 caracteres |
| `TOKEN_ENCRYPTION_KEY` | 64 hex (32 bytes) |

## Migrations desta área

- `20260813120959_profiles_email_hardening.sql`
- `20260813121047_tenant_invites.sql`
- `20260813121148_rls_inactive_tenant_and_fk_cohesion.sql`
- `20260813121256_admin_audit_log.sql`

Aplique com seu processo local/CI (`supabase db push` / pipeline). **Não** rode migrations remotas a partir deste agente sem pedido explícito.
