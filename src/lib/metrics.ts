import {
  cachedDashboardQuery,
  dashboardFilterCacheKey,
} from "@/lib/dashboard-cache";
import { type DashboardFilters } from "@/lib/dashboard-filters";
import { fetchDashboardStageCounts } from "@/lib/dashboard-rpc";
import type { DashboardMetrics } from "@/types/database";

export async function loadDashboardMetrics(
  tenantId: string,
  filters: DashboardFilters,
): Promise<DashboardMetrics> {
  return cachedDashboardQuery(
    "metrics",
    tenantId,
    dashboardFilterCacheKey(filters),
    async (supabase) => {
      const counts = await fetchDashboardStageCounts(supabase, tenantId, filters);

      const leadsTotal = counts.leads_total;
      const taxaConversao =
        leadsTotal > 0 ? Math.round((counts.venda / leadsTotal) * 1000) / 10 : 0;

      return {
        leadsTotal,
        mql: counts.mql,
        sal: counts.sal,
        sql: counts.sql,
        oportunidade: counts.oportunidade,
        negociacao: counts.negociacao,
        venda: counts.venda,
        perda: counts.perda,
        receitaFechada: Number(counts.receita_fechada) || 0,
        taxaConversao,
      };
    },
  );
}
