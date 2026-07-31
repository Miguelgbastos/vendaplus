import { redirect } from "next/navigation";
import { MarketingAnalyticsDashboard } from "@/components/dashboards/marketing-analytics-dashboard";
import { getActiveTenant, requireUser } from "@/lib/auth";
import { loadMarketingAnalytics } from "@/lib/dashboard-analytics";

export default async function MarketingDashboardPage() {
  const { userId } = await requireUser();
  if (!userId) redirect("/login");
  const membership = await getActiveTenant(userId);
  if (!membership) redirect("/dashboard");
  const analytics = await loadMarketingAnalytics(membership.tenant.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">Marketing</h1>
        <p className="mt-1 text-sm text-muted-foreground">Entenda quais origens, campanhas e criativos geram avanço real no funil.</p>
      </div>
      <MarketingAnalyticsDashboard data={analytics} />
    </div>
  );
}
