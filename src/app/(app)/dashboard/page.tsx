import { redirect } from "next/navigation";
import { DashboardFiltersBar } from "@/components/dashboards/dashboard-filters";
import { MetricsGrid } from "@/components/dashboards/metrics-grid";
import { getActiveTenant, requireUser } from "@/lib/auth";
import { loadDashboardFilterOptions } from "@/lib/dashboard-filter-options";
import { parseDashboardFilters } from "@/lib/dashboard-filters";
import { loadDashboardMetrics } from "@/lib/metrics";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { userId } = await requireUser();
  if (!userId) redirect("/login");

  const membership = await getActiveTenant(userId);
  if (!membership) {
    return (
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">
          Dashboard geral
        </h1>
        <p className="text-muted-foreground">
          Crie ou selecione uma empresa em Configurações → Empresas para ver métricas.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const { filters, clamped } = parseDashboardFilters(params);
  const [metrics, options] = await Promise.all([
    loadDashboardMetrics(membership.tenant.id, filters),
    loadDashboardFilterOptions(membership.tenant.id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">
          Dashboard geral
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Visão consolidada do funil para {membership.tenant.name}.
        </p>
      </div>
      <DashboardFiltersBar
        filters={filters}
        options={options}
        clamped={clamped}
      />
      <MetricsGrid metrics={metrics} empty={metrics.leadsTotal === 0} />
    </div>
  );
}
