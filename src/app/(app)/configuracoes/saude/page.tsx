import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canManageTenant, getActiveTenant, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReplayDeadJobsButton } from "@/components/admin/replay-dead-jobs-button";

export default async function TenantHealthPage() {
  const { userId } = await requireUser();
  if (!userId) redirect("/login");
  const membership = await getActiveTenant(userId);
  if (!membership) redirect("/configuracoes/empresas");
  if (!canManageTenant(membership.role)) redirect("/configuracoes");

  const admin = createAdminClient();
  const tenantId = membership.tenant.id;

  const [
    { count: pendingJobs },
    { count: processingJobs },
    { count: failedJobs },
    { count: deadJobs },
    { data: kommo },
    { data: meta },
    { data: recentAudit },
  ] = await Promise.all([
    admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "pending"),
    admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "processing"),
    admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "failed"),
    admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "dead"),
    admin
      .from("kommo_connections")
      .select("status, last_error, token_expires_at, connected_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    admin
      .from("meta_capi_connections")
      .select("status, is_enabled, last_error, last_sent_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    admin
      .from("admin_audit_log")
      .select("id, action, entity_type, created_at, metadata")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">Saúde da empresa</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Filas, integrações e auditoria administrativa de {membership.tenant.name}.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Pending</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{pendingJobs ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Processing</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{processingJobs ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Failed</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{failedJobs ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Dead</CardTitle>
            <CardDescription>Replay controlado</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xl font-semibold">{deadJobs ?? 0}</p>
            <ReplayDeadJobsButton companyId={tenantId} disabled={(deadJobs ?? 0) === 0} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Kommo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span>Status</span>
              <Badge>{kommo?.status ?? "ausente"}</Badge>
            </div>
            <p className="text-muted-foreground">
              Expira: {kommo?.token_expires_at ? new Date(kommo.token_expires_at).toLocaleString("pt-BR") : "—"}
            </p>
            {kommo?.last_error ? (
              <p className="text-destructive">{kommo.last_error}</p>
            ) : null}
            <Button asChild variant="secondary" size="sm">
              <Link href="/configuracoes/kommo">Abrir Kommo</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Meta CAPI</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span>Status</span>
              <Badge>{meta?.status ?? "ausente"}</Badge>
              <Badge>{meta?.is_enabled ? "ativo" : "inativo"}</Badge>
            </div>
            <p className="text-muted-foreground">
              Último envio:{" "}
              {meta?.last_sent_at ? new Date(meta.last_sent_at).toLocaleString("pt-BR") : "—"}
            </p>
            {meta?.last_error ? <p className="text-destructive">{meta.last_error}</p> : null}
            <Button asChild variant="secondary" size="sm">
              <Link href="/configuracoes/meta-capi">Abrir Meta CAPI</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Auditoria recente</CardTitle>
          <CardDescription>Ações administrativas nesta empresa.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(recentAudit ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum evento ainda.</p>
          ) : (
            (recentAudit ?? []).map((row) => (
              <div
                key={row.id}
                className="flex flex-col gap-1 rounded-md border border-border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <span>
                  {row.action} · {row.entity_type}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(row.created_at).toLocaleString("pt-BR")}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
