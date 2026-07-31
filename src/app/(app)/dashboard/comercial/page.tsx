import { redirect } from "next/navigation";
import { CommercialAnalyticsDashboard } from "@/components/dashboards/commercial-analytics-dashboard";
import { getActiveTenant, requireUser } from "@/lib/auth";
import { loadCommercialAnalytics } from "@/lib/dashboard-analytics";

export default async function ComercialDashboardPage() {
  const { userId } = await requireUser();
  if (!userId) redirect("/login");
  const membership = await getActiveTenant(userId);
  if (!membership) redirect("/dashboard");
  const analytics = await loadCommercialAnalytics(membership.tenant.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">Comercial</h1>
        <p className="mt-1 text-sm text-muted-foreground">Acompanhe conversões, campanhas, perdas e leads que precisam de atenção.</p>
      </div>
      <CommercialAnalyticsDashboard data={analytics} />
    </div>
  );
}
