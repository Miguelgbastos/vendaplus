import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricsGrid } from "@/components/dashboards/metrics-grid";
import { getActiveTenant, requireUser } from "@/lib/auth";
import { loadDashboardMetrics } from "@/lib/metrics";
import { createClient } from "@/lib/supabase/server";
import { formatNumber } from "@/lib/utils";

export default async function MarketingDashboardPage() {
  const { userId } = await requireUser();
  if (!userId) redirect("/login");
  const membership = await getActiveTenant(userId);
  if (!membership) redirect("/dashboard");

  const metrics = await loadDashboardMetrics(membership.tenant.id);
  const supabase = await createClient();
  const { data: acquisitionLeads } = await supabase
    .from("leads")
    .select(
      "id, name, kommo_lead_id, qualification, utm_source, utm_medium, utm_campaign, utm_content, utm_term, updated_at",
    )
    .eq("tenant_id", membership.tenant.id)
    .order("updated_at", { ascending: false });

  const sourceCounts = new Map<string, number>();
  for (const row of acquisitionLeads ?? []) {
    const key = row.utm_source || "(sem utm_source)";
    sourceCounts.set(key, (sourceCounts.get(key) || 0) + 1);
  }
  const topSources = [...sourceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">
          Marketing
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Volume de MQL/SAL e origem de aquisição via UTMs.
        </p>
      </div>
      <MetricsGrid metrics={metrics} />
      <Card>
        <CardHeader>
          <CardTitle>Top fontes (utm_source)</CardTitle>
          <CardDescription>Leads agrupados pela origem normalizada</CardDescription>
        </CardHeader>
        <CardContent>
          {topSources.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
          ) : (
            <ul className="space-y-2">
              {topSources.map(([source, count]) => (
                <li
                  key={source}
                  className="flex items-center justify-between border-b border-border py-2 text-sm"
                >
                  <span className="text-secondary-foreground">{source}</span>
                  <span className="text-primary">{formatNumber(count)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Leads e UTMs</CardTitle>
          <CardDescription>
            Dados de aquisição mais recentes sincronizados da Kommo
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!acquisitionLeads?.length ? (
            <p className="text-sm text-muted-foreground">Sem dados ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">Lead</th>
                    <th className="pb-2 font-medium">GWE</th>
                    <th className="pb-2 font-medium">Origem</th>
                    <th className="pb-2 font-medium">Mídia</th>
                    <th className="pb-2 font-medium">Campanha</th>
                    <th className="pb-2 font-medium">Conteúdo</th>
                    <th className="pb-2 font-medium">Termo</th>
                  </tr>
                </thead>
                <tbody>
                  {acquisitionLeads.slice(0, 20).map((lead) => (
                    <tr key={lead.id} className="border-t border-border align-top">
                      <td className="py-3 pr-4 text-foreground">
                        <div>{lead.name || `Lead #${lead.kommo_lead_id}`}</div>
                        <div className="text-xs text-muted-foreground">
                          #{lead.kommo_lead_id}
                        </div>
                      </td>
                      <td className="py-3 pr-4 uppercase text-primary">
                        {lead.qualification || "—"}
                      </td>
                      <td className="py-3 pr-4">{lead.utm_source || "—"}</td>
                      <td className="py-3 pr-4">{lead.utm_medium || "—"}</td>
                      <td className="max-w-64 py-3 pr-4">{lead.utm_campaign || "—"}</td>
                      <td className="max-w-64 py-3 pr-4">{lead.utm_content || "—"}</td>
                      <td className="max-w-64 py-3">{lead.utm_term || "—"}</td>
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
