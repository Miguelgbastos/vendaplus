# Auth, convites e SMTP (self-hosted)

## Modelo de acesso

1. **Antes do primeiro setup** (`app_installations` vazio): `/cadastro` permanece aberto para criar o operador inicial.
2. **Depois do setup**: o cadastro aberto redireciona para login (`signup=invite_only`). Novos usuários entram só por convite.
3. **Usuário já existente** (mesmo e-mail em `auth.users`): o admin adiciona membership imediatamente via `manage_company_user` (identidade resolvida em `auth.users`, não em `profiles.email`).
4. **Usuário novo**: o servidor cria `tenant_invites` (token hasheado) e chama `auth.admin.inviteUserByEmail` — nunca no browser.

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

- `20260813010000_profiles_email_hardening.sql`
- `20260813011000_tenant_invites.sql`
- `20260813012000_rls_inactive_tenant_and_fk_cohesion.sql`
- `20260813015000_admin_audit_log.sql`

Aplique com seu processo local/CI (`supabase db push` / pipeline). **Não** rode migrations remotas a partir deste agente sem pedido explícito.
