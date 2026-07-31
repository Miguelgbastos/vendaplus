import { redirect } from "next/navigation";
import { CommercialAnalyticsDashboard } from "@/components/dashboards/commercial-analytics-dashboard";
import { DashboardFiltersBar } from "@/components/dashboards/dashboard-filters";
import { getActiveTenant, requireUser } from "@/lib/auth";
import { loadCommercialAnalytics } from "@/lib/dashboard-analytics";
import { loadDashboardFilterOptions } from "@/lib/dashboard-filter-options";
import { parseDashboardFilters } from "@/lib/dashboard-filters";

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
  const [analytics, options] = await Promise.all([
    loadCommercialAnalytics(membership.tenant.id, filters),
    loadDashboardFilterOptions(membership.tenant.id),
  ]);

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
        options={options}
        clamped={clamped}
      />
      <CommercialAnalyticsDashboard
        data={analytics}
        empty={analytics.filteredLeads === 0}
      />
    </div>
  );
}
