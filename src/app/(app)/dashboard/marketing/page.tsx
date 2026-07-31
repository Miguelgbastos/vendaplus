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
  const { data: bySource } = await supabase
    .from("leads")
    .select("utm_source")
    .eq("tenant_id", membership.tenant.id);

  const sourceCounts = new Map<string, number>();
  for (const row of bySource ?? []) {
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
    </div>
  );
}
