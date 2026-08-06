import dynamic from "next/dynamic";
import { redirect } from "next/navigation";
import { DashboardFiltersBar } from "@/components/dashboards/dashboard-filters";
import { DashboardChartsFallback } from "@/components/dashboards/dashboard-charts-fallback";
import { getActiveTenant, requireUser } from "@/lib/auth";
import { loadCommercialAnalytics } from "@/lib/dashboard-analytics";
import { parseDashboardFilters } from "@/lib/dashboard-filters";

const CommercialAnalyticsDashboard = dynamic(
  () =>
    import("@/components/dashboards/commercial-analytics-dashboard").then(
      (mod) => mod.CommercialAnalyticsDashboard,
    ),
  { loading: () => <DashboardChartsFallback /> },
);

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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
  const { data: analytics, filterOptions } = await loadCommercialAnalytics(
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
      <CommercialAnalyticsDashboard
        data={analytics}
        empty={analytics.filteredLeads === 0}
      />
    </div>
  );
}
