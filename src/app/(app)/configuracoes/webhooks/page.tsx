import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canManageTenant, getActiveTenant, requireUser } from "@/lib/auth";
import { getAppUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { WebhooksManager } from "@/components/webhooks/webhooks-manager";

export default async function WebhooksSettingsPage() {
  const { userId } = await requireUser();
  if (!userId) redirect("/login");
  const membership = await getActiveTenant(userId);
  if (!membership) redirect("/configuracoes/empresas");
  if (!canManageTenant(membership.role)) redirect("/configuracoes");

  const admin = createAdminClient();
  const { data: connections, error } = await admin
    .from("crm_connections")
    .select("id, name, provider, schema_version, is_active, created_at, updated_at")
    .eq("tenant_id", membership.tenant.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`crm_connections_lookup_failed:${error.message}`);

  const connectionIds = (connections ?? []).map((row) => row.id);
  const [{ data: endpoints }, eventBundles] = await Promise.all([
    connectionIds.length
      ? admin.from("webhook_endpoints").select("id, connection_id, endpoint_public_id, is_active").in("connection_id", connectionIds)
      : Promise.resolve({ data: [] }),
    Promise.all(
      connectionIds.map(async (connectionId) => {
        const [{ data: events, count: receivedCount }, { count: processedCount }] = await Promise.all([
          admin
            .from("raw_events")
            .select("id, connection_id, external_event_id, event_type, received_at, processed_at", { count: "exact" })
            .eq("connection_id", connectionId)
            .order("received_at", { ascending: false })
            .limit(5),
          admin
            .from("raw_events")
            .select("id", { count: "exact", head: true })
            .eq("connection_id", connectionId)
            .not("processed_at", "is", null),
        ]);
        return {
          connectionId,
          events: events ?? [],
          receivedCount: receivedCount ?? 0,
          processedCount: processedCount ?? 0,
        };
      }),
    ),
  ]);

  const endpointByConnection = new Map((endpoints ?? []).map((row) => [row.connection_id, row]));
  const eventsByConnection = new Map(eventBundles.map((bundle) => [bundle.connectionId, bundle]));
  const appUrl = getAppUrl();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">Webhooks</h1>
        <p className="mt-1 text-sm text-muted-foreground">Gerencie conexões de CRM que enviam dados GWE v1 para o Venda+.</p>
      </div>
      {error ? <p className="rounded-lg alert-error px-3 py-2 text-sm">Não foi possível carregar as conexões.</p> : null}
      <WebhooksManager tenantId={membership.tenant.id} appUrl={appUrl} initialConnections={(connections ?? []).map((connection) => {
        const bundle = eventsByConnection.get(connection.id);
        return {
          ...connection,
          endpoint: endpointByConnection.get(connection.id) ?? null,
          events: bundle?.events ?? [],
          receivedCount: bundle?.receivedCount ?? 0,
          processedCount: bundle?.processedCount ?? 0,
        };
      })} />
      <Card>
        <CardHeader>
          <CardTitle>Contrato GWE v1</CardTitle>
          <CardDescription>Use esta referência para configurar seu CRM ou middleware.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p><code>POST /api/v1/webhooks/crm/{"{endpoint_id}"}</code></p>
          <p><code>X-GWE-Timestamp</code>, <code>X-GWE-Key-Id</code> e <code>X-GWE-Signature</code></p>
          <p>Content-Type: application/json · máximo 1 MiB · timestamp com tolerância de 5 minutos.</p>
          <div className="flex flex-wrap gap-2">
            <Badge>202 accepted</Badge><Badge>200 already_received</Badge><Badge>409 event_id_collision</Badge><Badge>401 invalid_signature</Badge><Badge>422 invalid_gwe_payload</Badge><Badge>429 rate_limited</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
