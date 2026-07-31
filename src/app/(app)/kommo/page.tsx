import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyRedirectUri } from "@/components/kommo/copy-redirect-uri";
import { KommoCredentialsForm } from "@/components/kommo/credentials-form";
import { KommoAuthorizeButton } from "@/components/kommo/authorize-button";
import { KommoStepper } from "@/components/kommo/stepper";
import { canManageTenant, getActiveTenant, requireUser } from "@/lib/auth";
import { getAppUrl, getKommoRedirectUri } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const KOMMO_ERROR_MESSAGES: Record<string, string> = {
  kommo_not_configured:
    "Salve a configuração da integração privada deste tenant (subdomínio, Integration ID e Secret Key) antes de autorizar.",
  invalid_subdomain:
    "Subdomínio inválido. Use apenas o nome da conta (ex.: minhaempresa) ou minhaempresa.kommo.com.",
  oauth_missing: "Não foi possível iniciar a conexão. Tente novamente.",
  oauth_failed: "Falha na conexão OAuth com o Kommo. Tente novamente.",
  oauth_state_used:
    "Este link de autorização já foi usado ou expirou. Inicie a conexão novamente.",
  oauth_user_mismatch:
    "A sessão atual não corresponde ao usuário que iniciou a conexão. Entre com a conta correta e tente de novo.",
  connected: "Kommo conectado com sucesso.",
};

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
  searchParams: Promise<{ connected?: string; error?: string }>;
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
          Crie um tenant antes de conectar o Kommo.
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
          Onboarding guiado da integração privada por organização.
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
            {connection?.last_error ? (
              <p className="text-destructive">{connection.last_error}</p>
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
              <code className="block break-all rounded-lg border border-border bg-muted p-3 text-xs text-primary">
                {webhookUrl}
              </code>
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
              <CardTitle>Passo 3 — Credenciais deste tenant</CardTitle>
              <CardDescription>
                Subdomínio, Integration ID e Secret Key. Isolados por organização.
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
