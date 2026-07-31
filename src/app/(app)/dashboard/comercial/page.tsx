import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricsGrid } from "@/components/dashboards/metrics-grid";
import { getActiveTenant, requireUser } from "@/lib/auth";
import { loadDashboardMetrics } from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";
import { formatCurrencyBRL } from "@/lib/utils";

export default async function ComercialDashboardPage() {
  const { userId } = await requireUser();
  if (!userId) redirect("/login");
  const membership = await getActiveTenant(userId);
  if (!membership) redirect("/dashboard");

  const metrics = await loadDashboardMetrics(membership.tenant.id);
  const supabase = await createClient();
  const { data: recent } = await supabase
    .from("leads")
    .select("id, name, qualification, price, status_name, updated_at")
    .eq("tenant_id", membership.tenant.id)
    .in("qualification", ["sql", "oportunidade", "negociacao", "venda", "perda"])
    .order("updated_at", { ascending: false })
    .limit(12);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">
          Comercial
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pipeline comercial, negociação e fechamentos.
        </p>
      </div>
      <MetricsGrid metrics={metrics} />
      <Card>
        <CardHeader>
          <CardTitle>Leads comerciais recentes</CardTitle>
          <CardDescription>SQL em diante, ordenados por atualização</CardDescription>
        </CardHeader>
        <CardContent>
          {!recent?.length ? (
            <p className="text-sm text-muted-foreground">Sem leads comerciais ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">Lead</th>
                    <th className="pb-2 font-medium">Qualificação</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((lead) => (
                    <tr key={lead.id} className="border-t border-border">
                      <td className="py-2 text-foreground">{lead.name || "—"}</td>
                      <td className="py-2 uppercase text-muted-foreground">
                        {lead.qualification || "—"}
                      </td>
                      <td className="py-2 text-muted-foreground">{lead.status_name || "—"}</td>
                      <td className="py-2 text-primary">
                        {formatCurrencyBRL(lead.price != null ? Number(lead.price) : null)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
