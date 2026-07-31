import { redirect } from "next/navigation";
import { DashboardFiltersBar } from "@/components/dashboards/dashboard-filters";
import { MarketingAnalyticsDashboard } from "@/components/dashboards/marketing-analytics-dashboard";
import { getActiveTenant, requireUser } from "@/lib/auth";
import { loadMarketingAnalytics } from "@/lib/dashboard-analytics";
import { loadDashboardFilterOptions } from "@/lib/dashboard-filter-options";
import { parseDashboardFilters } from "@/lib/dashboard-filters";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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
  const [analytics, options] = await Promise.all([
    loadMarketingAnalytics(membership.tenant.id, filters),
    loadDashboardFilterOptions(membership.tenant.id),
  ]);

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
        options={options}
        clamped={clamped}
      />
      <MarketingAnalyticsDashboard
        data={analytics}
        empty={analytics.summary.leads === 0}
      />
    </div>
  );
}
