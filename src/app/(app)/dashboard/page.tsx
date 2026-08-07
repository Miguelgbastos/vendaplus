import dynamic from "next/dynamic";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { DashboardFiltersBar } from "@/components/dashboards/dashboard-filters";
import { DashboardChartsFallback } from "@/components/dashboards/dashboard-charts-fallback";
import { getActiveTenant, requireUser } from "@/lib/auth";
import { loadDashboardFilterOptions } from "@/lib/dashboard-filter-options";
import {
  parseDashboardFilters,
  type DashboardFilters,
} from "@/lib/dashboard-filters";
import { loadDashboardMetrics } from "@/lib/metrics";

const MetricsGrid = dynamic(
  () =>
    import("@/components/dashboards/metrics-grid").then(
      (mod) => mod.MetricsGrid,
    ),
  { loading: () => <DashboardChartsFallback /> },
);

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function MetricsSection({
  tenantId,
  filters,
}: {
  tenantId: string;
  filters: DashboardFilters;
}) {
  const metrics = await loadDashboardMetrics(tenantId, filters);
  return <MetricsGrid metrics={metrics} empty={metrics.leadsTotal === 0} />;
}

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
  // Light distinct-values RPC: the filters bar stays in the initial chunk
  // while the heavy aggregation streams inside Suspense below.
  const filterOptions = await loadDashboardFilterOptions(
    membership.tenant.id,
    filters,
  );

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
        options={filterOptions}
        clamped={clamped}
      />
      <Suspense fallback={<DashboardChartsFallback />}>
        <MetricsSection tenantId={membership.tenant.id} filters={filters} />
      </Suspense>
    </div>
  );
}
