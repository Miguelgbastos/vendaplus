import dynamic from "next/dynamic";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { DashboardFiltersBar } from "@/components/dashboards/dashboard-filters";
import { DashboardChartsFallback } from "@/components/dashboards/dashboard-charts-fallback";
import { getActiveTenant, requireUser } from "@/lib/auth";
import { loadMarketingAnalytics } from "@/lib/dashboard-analytics";
import { loadDashboardFilterOptions } from "@/lib/dashboard-filter-options";
import {
  parseDashboardFilters,
  type DashboardFilters,
} from "@/lib/dashboard-filters";

const MarketingAnalyticsDashboard = dynamic(
  () =>
    import("@/components/dashboards/marketing-analytics-dashboard").then(
      (mod) => mod.MarketingAnalyticsDashboard,
    ),
  { loading: () => <DashboardChartsFallback /> },
);

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function MarketingSection({
  tenantId,
  filters,
}: {
  tenantId: string;
  filters: DashboardFilters;
}) {
  const analytics = await loadMarketingAnalytics(tenantId, filters);
  return (
    <MarketingAnalyticsDashboard
      data={analytics}
      empty={analytics.summary.leads === 0}
    />
  );
}

export default async function MarketingDashboardPage({
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
          Marketing
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Entenda quais origens, campanhas e criativos geram avanço real no
          funil.
        </p>
      </div>
      <DashboardFiltersBar
        filters={filters}
        options={filterOptions}
        clamped={clamped}
      />
      <Suspense fallback={<DashboardChartsFallback />}>
        <MarketingSection tenantId={membership.tenant.id} filters={filters} />
      </Suspense>
    </div>
  );
}
