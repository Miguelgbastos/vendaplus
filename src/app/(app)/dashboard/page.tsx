import { redirect } from "next/navigation";
import { MetricsGrid } from "@/components/dashboards/metrics-grid";
import { getActiveTenant, requireUser } from "@/lib/auth";
import { loadDashboardMetrics } from "@/lib/metrics";

export default async function DashboardPage() {
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
          Crie ou entre em uma organização em Admin → Tenants para ver métricas.
        </p>
      </div>
    );
  }

  const metrics = await loadDashboardMetrics(membership.tenant.id);

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
      <MetricsGrid metrics={metrics} />
    </div>
  );
}
