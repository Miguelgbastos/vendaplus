import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MetaCapiCredentialsForm } from "@/components/meta-capi/credentials-form";
import { MetaCapiEventMappingsForm } from "@/components/meta-capi/event-mappings-form";
import { MetaCapiTestButton } from "@/components/meta-capi/test-button";
import { canManageTenant, getActiveTenant, requireUser } from "@/lib/auth";
import { DEFAULT_QUALIFICATION_EVENT_MAP } from "@/lib/meta-capi/event";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { QualificationStage } from "@/types/database";

const QUALIFICATIONS: QualificationStage[] = [
  "mql",
  "sal",
  "sql",
  "oportunidade",
  "negociacao",
  "venda",
  "perda",
];

export default async function MetaCapiSettingsPage() {
  const { userId } = await requireUser();
  if (!userId) redirect("/login");

  const membership = await getActiveTenant(userId);
  if (!membership) {
    return (
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">
          Meta CAPI
        </h1>
        <p className="mt-2 text-muted-foreground">
          Crie uma empresa antes de configurar o servidor de conversão do Meta.
        </p>
      </div>
    );
  }

  const isAdmin = canManageTenant(membership.role);
  const supabase = await createClient();

  const { data: connection } = await supabase
    .from("meta_capi_connections")
    .select(
      "id, pixel_id, status, is_enabled, test_event_code, last_error, last_sent_at, connected_at",
    )
    .eq("tenant_id", membership.tenant.id)
    .maybeSingle();

  let accessTokenConfigured = false;
  if (isAdmin) {
    const admin = createAdminClient();
    const { data: secrets } = await admin
      .from("meta_capi_connections")
      .select("access_token_encrypted")
      .eq("tenant_id", membership.tenant.id)
      .maybeSingle();
    accessTokenConfigured = Boolean(secrets?.access_token_encrypted);
  }

  const { data: mappingsData } = await supabase
    .from("meta_capi_event_mappings")
    .select(
      "qualification, event_name, include_value, currency, is_active, action_source",
    )
    .eq("tenant_id", membership.tenant.id);

  const mappingByStage = new Map(
    (mappingsData ?? []).map((row) => [row.qualification as QualificationStage, row]),
  );

  const mappings = QUALIFICATIONS.map((qualification) => {
    const existing = mappingByStage.get(qualification);
    return (
      existing ?? {
        qualification,
        event_name: DEFAULT_QUALIFICATION_EVENT_MAP[qualification] ?? "Lead",
        include_value: qualification === "venda" || qualification === "negociacao",
        currency: "BRL",
        is_active: qualification !== "perda",
        action_source: "system_generated",
      }
    );
  });

  const { data: recentEvents } = await supabase
    .from("meta_capi_events")
    .select(
      "id, qualification, event_name, status, http_status, fbtrace_id, error_message, sent_at, created_at",
    )
    .eq("tenant_id", membership.tenant.id)
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">
          Servidor de conversão Meta Ads (CAPI)
        </h1>
        <p className="text-sm text-muted-foreground">
          Envie eventos CRM da empresa ativa direto para o Pixel do Meta com
          hashing SHA-256 e deduplicação por event_id. Credenciais são
          criptografadas e isoladas por empresa.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>
            O Access Token do System User nunca retorna ao navegador.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Conexão</span>
            <Badge>{connection?.status ?? "não configurado"}</Badge>
            <span className="text-muted-foreground">Envio automático</span>
            <Badge>{connection?.is_enabled ? "ativo" : "desligado"}</Badge>
            {accessTokenConfigured ? (
              <Badge className="border-transparent bg-primary-soft text-primary">
                token configurado
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground">
            Pixel ID:{" "}
            <span className="text-foreground">{connection?.pixel_id ?? "—"}</span>
          </p>
          <p className="text-muted-foreground">
            Test Event Code:{" "}
            <span className="text-foreground">
              {connection?.test_event_code ?? "—"}
            </span>
          </p>
          <p className="text-muted-foreground">
            Último envio:{" "}
            <span className="text-foreground">
              {connection?.last_sent_at
                ? new Date(connection.last_sent_at).toLocaleString("pt-BR")
                : "—"}
            </span>
          </p>
          {connection?.last_error ? (
            <p className="text-destructive">Último erro: {connection.last_error}</p>
          ) : null}
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Credenciais do Pixel</CardTitle>
            <CardDescription>
              Pixel ID (Events Manager) e Access Token de System User com
              permissão de escrita.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MetaCapiCredentialsForm
              tenantId={membership.tenant.id}
              initialPixelId={connection?.pixel_id ?? ""}
              initialTestEventCode={connection?.test_event_code ?? ""}
              accessTokenConfigured={accessTokenConfigured}
              initialIsEnabled={Boolean(connection?.is_enabled)}
            />
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          Apenas owner/admin podem configurar o servidor de conversão Meta.
        </p>
      )}

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Testar envio</CardTitle>
            <CardDescription>
              Dispara um evento Lead sintético para validar Pixel + token +
              Test Event Code no Events Manager.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MetaCapiTestButton tenantId={membership.tenant.id} />
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Mapa de eventos por qualificação</CardTitle>
            <CardDescription>
              Cada transição de qualificação do lead dispara o evento
              correspondente. Desative para não enviar aquele estágio.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MetaCapiEventMappingsForm
              tenantId={membership.tenant.id}
              initialMappings={mappings}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Últimos eventos</CardTitle>
          <CardDescription>
            10 eventos mais recentes enviados pelo servidor de conversão.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!recentEvents?.length ? (
            <p className="text-sm text-muted-foreground">
              Nenhum evento enviado ainda.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recentEvents.map((ev) => (
                <li
                  key={ev.id}
                  className="flex flex-wrap items-center gap-2 border-b border-border py-2"
                >
                  <span className="text-secondary-foreground">
                    {new Date(ev.created_at).toLocaleString("pt-BR")}
                  </span>
                  <Badge>{ev.event_name}</Badge>
                  <span className="text-muted-foreground">
                    {ev.qualification ?? "—"}
                  </span>
                  <Badge
                    className={
                      ev.status === "sent"
                        ? "border-transparent bg-primary-soft text-primary"
                        : ev.status === "failed"
                          ? "border-transparent bg-destructive/10 text-destructive"
                          : ""
                    }
                  >
                    {ev.status}
                  </Badge>
                  {ev.http_status ? (
                    <span className="text-muted-foreground">
                      HTTP {ev.http_status}
                    </span>
                  ) : null}
                  {ev.error_message ? (
                    <span className="text-destructive">{ev.error_message}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
