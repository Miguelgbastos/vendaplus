import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyRedirectUri } from "@/components/kommo/copy-redirect-uri";
import { KommoCredentialsForm } from "@/components/kommo/credentials-form";
import { KommoAuthorizeButton } from "@/components/kommo/authorize-button";
import { KommoStepper } from "@/components/kommo/stepper";
import { WebhookSetup } from "@/components/kommo/webhook-setup";
import { SyncKommoUsersButton } from "@/components/kommo/sync-users-button";
import { canManageTenant, getActiveTenant, requireUser } from "@/lib/auth";
import { getAppUrl, getKommoRedirectUri } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const KOMMO_ERROR_MESSAGES: Record<string, string> = {
  kommo_not_configured:
    "Salve a configuração da integração privada desta empresa (subdomínio, Integration ID e Secret Key) antes de autorizar.",
  invalid_subdomain:
    "Subdomínio inválido. Use apenas o nome da conta (ex.: minhaempresa) ou minhaempresa.kommo.com.",
  oauth_missing: "Não foi possível iniciar a conexão. Tente novamente.",
  oauth_failed: "Falha na conexão OAuth com o Kommo. Tente novamente.",
  oauth_exchange_failed:
    "O Kommo autorizou o acesso, mas recusou a troca do código por tokens. Confira a Secret Key e a URL de redirecionamento da integração.",
  oauth_rate_limited:
    "Muitas tentativas recentes foram bloqueadas pelo Kommo (403/429). Aguarde cerca de 5 minutos e autorize uma única vez.",
  oauth_account_mismatch:
    "A conta autorizada no Kommo não corresponde ao subdomínio configurado para esta empresa.",
  oauth_state_used:
    "Este link de autorização já foi usado ou expirou. Inicie a conexão novamente.",
  oauth_user_mismatch:
    "A sessão atual não corresponde ao usuário que iniciou a conexão. Entre com a conta correta e tente de novo.",
  connected: "Kommo conectado com sucesso.",
};

function friendlyLastError(lastError: string | null | undefined): string | null {
  if (!lastError) return null;
  if (lastError.startsWith("kommo_oauth_exchange_403")) {
    return "Troca OAuth bloqueada (HTTP 403). Aguarde o cooldown e tente uma única autorização; confira Secret Key e Redirect URI.";
  }
  if (lastError.startsWith("kommo_oauth_exchange_429")) {
    return "Limite de requisições OAuth atingido (HTTP 429). Aguarde alguns minutos antes de autorizar de novo.";
  }
  if (lastError.startsWith("kommo_oauth_exchange_503")) {
    return "Kommo temporariamente indisponível (HTTP 503). Tente novamente em alguns minutos.";
  }
  if (lastError.startsWith("kommo_oauth_exchange_")) {
    return "Falha na troca do código OAuth. Confira Integration ID, Secret Key e Redirect URI desta empresa.";
  }
  if (lastError === "kommo_oauth_account_mismatch") {
    return KOMMO_ERROR_MESSAGES.oauth_account_mismatch;
  }
  if (lastError === "kommo_oauth_callback_failed") {
    return KOMMO_ERROR_MESSAGES.oauth_failed;
  }
  return "Última tentativa de conexão falhou. Revise a configuração e tente novamente.";
}

function messageForKommoError(code: string | undefined): string | null {
  if (!code) return null;
  return (
    KOMMO_ERROR_MESSAGES[code] ||
    "Não foi possível concluir a operação. Tente novamente."
  );
}

export default async function KommoPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; users_sync?: string }>;
}) {
  const params = await searchParams;
  const { userId } = await requireUser();
  if (!userId) redirect("/login");

  const membership = await getActiveTenant(userId);
  if (!membership) {
    return (
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">Kommo</h1>
        <p className="mt-2 text-muted-foreground">
          Crie uma empresa antes de conectar o Kommo.
        </p>
      </div>
    );
  }

  const isAdmin = canManageTenant(membership.role);
  const supabase = await createClient();
  const { data: connection } = await supabase
    .from("kommo_connections")
    .select(
      "id, status, subdomain, account_id, token_expires_at, connected_at, last_error",
    )
    .eq("tenant_id", membership.tenant.id)
    .maybeSingle();

  let integrationId = "";
  let secretConfigured = false;
  let credentialsReady = false;

  if (isAdmin) {
    const admin = createAdminClient();
    const { data: secrets } = await admin
      .from("kommo_connections")
      .select("tenant_id, subdomain, integration_id, client_secret_encrypted")
      .eq("tenant_id", membership.tenant.id)
      .maybeSingle();

    if (secrets && secrets.tenant_id === membership.tenant.id) {
      integrationId = secrets.integration_id || "";
      secretConfigured = Boolean(secrets.client_secret_encrypted);
      credentialsReady = Boolean(
        secrets.subdomain && secrets.integration_id && secrets.client_secret_encrypted,
      );
    }
  }

  const webhook = isAdmin
    ? (
        await supabase
          .from("webhook_endpoints")
          .select("token, is_active")
          .eq("tenant_id", membership.tenant.id)
          .is("connection_id", null)
          .maybeSingle()
      ).data
    : null;

  const { data: mappings } = await supabase
    .from("field_mappings")
    .select("id, source_field, target_field, is_active")
    .eq("tenant_id", membership.tenant.id)
    .order("created_at", { ascending: true });

  const { count: jobsPending } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", membership.tenant.id)
    .in("status", ["pending", "failed", "processing"]);

  const { count: kommoUsersCount } = await supabase
    .from("kommo_users")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", membership.tenant.id)
    .eq("is_active", true);
  const { data: latestUserSync } = await supabase
    .from("kommo_users")
    .select("synced_at")
    .eq("tenant_id", membership.tenant.id)
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const webhookUrl =
    isAdmin && webhook?.token
      ? `${getAppUrl()}/api/webhooks/kommo/${webhook.token}`
      : null;

  const redirectUri = getKommoRedirectUri();
  const errorMessage = messageForKommoError(params.error);
  const connected = Boolean(params.connected) || connection?.status === "connected";
  const currentStep = connected ? 4 : credentialsReady ? 4 : integrationId || connection?.subdomain ? 3 : 1;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="font-display text-3xl font-semibold text-foreground">
          Integração Kommo
        </h1>
        <p className="text-sm text-muted-foreground">
          Onboarding guiado da integração privada por empresa.
        </p>
        {isAdmin ? <KommoStepper current={currentStep} /> : null}
      </div>

      {params.connected ? (
        <p className="rounded-lg alert-success px-3 py-2 text-sm">
          {KOMMO_ERROR_MESSAGES.connected}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="rounded-lg alert-error px-3 py-2 text-sm">{errorMessage}</p>
      ) : null}
      {params.users_sync === "failed" ? (
        <p className="rounded-lg alert-warning px-3 py-2 text-sm">
          Kommo conectado, mas os responsáveis ainda não foram sincronizados. Use o botão
          “Sincronizar usuários”.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>
              Tokens e Secret Key ficam criptografados e só o servidor os lê.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Conexão</span>
              <Badge>{connection?.status || "não conectado"}</Badge>
              <span className="text-muted-foreground">Credenciais</span>
              <Badge>{credentialsReady ? "configuradas" : "pendentes"}</Badge>
              {secretConfigured ? (
                <Badge className="border-transparent bg-primary-soft text-primary">
                  secret configurado
                </Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground">
              Subdomínio:{" "}
              <span className="text-foreground">{connection?.subdomain || "—"}</span>
            </p>
            <p className="text-muted-foreground">
              Conta:{" "}
              <span className="text-foreground">{connection?.account_id || "—"}</span>
            </p>
            <p className="text-muted-foreground">
              Expira em:{" "}
              <span className="text-foreground">
                {connection?.token_expires_at
                  ? new Date(connection.token_expires_at).toLocaleString("pt-BR")
                  : "—"}
              </span>
            </p>
            <p className="text-muted-foreground">
              Responsáveis ativos:{" "}
              <span className="text-foreground">{kommoUsersCount ?? 0}</span>
            </p>
            <p className="text-muted-foreground">
              Última sincronização:{" "}
              <span className="text-foreground">
                {latestUserSync?.synced_at
                  ? new Date(latestUserSync.synced_at).toLocaleString("pt-BR")
                  : "—"}
              </span>
            </p>
            {isAdmin ? (
              <SyncKommoUsersButton
                tenantId={membership.tenant.id}
                disabled={connection?.status !== "connected"}
              />
            ) : null}
            {friendlyLastError(connection?.last_error) ? (
              <p className="text-destructive">
                {friendlyLastError(connection?.last_error)}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Webhook</CardTitle>
            <CardDescription>
              Configure esta URL no Kommo após autorizar.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!isAdmin ? (
              <p className="text-muted-foreground">
                A URL do webhook é visível apenas para owner/admin.
              </p>
            ) : webhookUrl ? (
              <WebhookSetup value={webhookUrl} />
            ) : (
              <p className="text-muted-foreground">
                O endpoint é gerado automaticamente após a autorização OAuth.
              </p>
            )}
            <p className="text-muted-foreground">
              Jobs pendentes/processando:{" "}
              <span className="text-foreground">{jobsPending ?? 0}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {isAdmin ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Passo 1 — Criar integração privada no Kommo</CardTitle>
              <CardDescription>
                Configurações → Integrações → Criar integração → integração privada.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Use um nome claro (ex.: “Venda+ — {membership.tenant.name}”) e permissões
                mínimas de leads/contatos.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Passo 2 — Redirect URI</CardTitle>
              <CardDescription>
                Cole exatamente esta URL no campo Redirect URI da integração.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CopyRedirectUri value={redirectUri} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Passo 3 — Credenciais desta empresa</CardTitle>
              <CardDescription>
                Subdomínio, Integration ID e Secret Key. Isolados por empresa.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <KommoCredentialsForm
                tenantId={membership.tenant.id}
                initialSubdomain={connection?.subdomain || ""}
                initialIntegrationId={integrationId}
                secretConfigured={secretConfigured}
              />
            </CardContent>
          </Card>

          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle>Passo 4 — Autorizar</CardTitle>
              <CardDescription>
                CTA disponível somente após salvar a configuração completa.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <KommoAuthorizeButton
                tenantId={membership.tenant.id}
                enabled={credentialsReady}
              />
            </CardContent>
          </Card>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Apenas owner/admin podem configurar a integração privada do Kommo.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Mapeamento de campos</CardTitle>
          <CardDescription>
            Targets: qualification, utm_*, name, price, status_name…
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!mappings?.length ? (
            <p className="text-sm text-muted-foreground">
              Nenhum mapeamento customizado. A normalização dinâmica permanece ativa.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {mappings.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between border-b border-border py-2"
                >
                  <span className="text-secondary-foreground">
                    {m.source_field} → {m.target_field}
                  </span>
                  <Badge>{m.is_active ? "ativo" : "inativo"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
