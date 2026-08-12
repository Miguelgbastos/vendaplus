import dynamic from "next/dynamic";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { DashboardFiltersBar } from "@/components/dashboards/dashboard-filters";
import { DashboardChartsFallback } from "@/components/dashboards/dashboard-charts-fallback";
import { getActiveTenant, requireUser } from "@/lib/auth";
import { loadCommercialAnalytics } from "@/lib/dashboard-analytics";
import { loadDashboardFilterOptions } from "@/lib/dashboard-filter-options";
import {
  parseDashboardFilters,
  type DashboardFilters,
} from "@/lib/dashboard-filters";

const CommercialAnalyticsDashboard = dynamic(
  () =>
    import("@/components/dashboards/commercial-analytics-dashboard").then(
      (mod) => mod.CommercialAnalyticsDashboard,
    ),
  { loading: () => <DashboardChartsFallback /> },
);

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function CommercialSection({
  tenantId,
  filters,
}: {
  tenantId: string;
  filters: DashboardFilters;
}) {
  const analytics = await loadCommercialAnalytics(tenantId, filters);
  return (
    <CommercialAnalyticsDashboard
      data={analytics}
      empty={
        analytics.filteredLeads === 0 &&
        analytics.summary.vendaFechada === 0 &&
        analytics.summary.perdaFechada === 0
      }
    />
  );
}

export default async function ComercialDashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { userId } = await requireUser();
  if (!userId) redirect("/login");
  const membership = await getActiveTenant(userId);
  if (!membership) redirect("/dashboard");

  const params = await searchParams;
  const { filters, clamped } = parseDashboardFilters(params);
  const filterOptions = await loadDashboardFilterOptions(
    membership.tenant.id,
    filters,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">
          Comercial
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Acompanhe conversões, campanhas, perdas e leads que precisam de
          atenção.
        </p>
      </div>
      <DashboardFiltersBar
        filters={filters}
        options={filterOptions}
        clamped={clamped}
      />
      <Suspense fallback={<DashboardChartsFallback />}>
        <CommercialSection tenantId={membership.tenant.id} filters={filters} />
      </Suspense>
    </div>
  );
}
