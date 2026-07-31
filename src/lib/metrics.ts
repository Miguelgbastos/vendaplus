import { createClient } from "@/lib/supabase/server";
import {
  applyLeadFilters,
  leadReachedStages,
  type DashboardFilters,
} from "@/lib/dashboard-filters";
import { fetchAllFilteredLeads } from "@/lib/dashboard-query";
import type { DashboardMetrics, QualificationStage } from "@/types/database";

const STAGES: QualificationStage[] = [
  "mql",
  "sal",
  "sql",
  "oportunidade",
  "negociacao",
  "venda",
  "perda",
];

type MetricsLeadRow = {
  qualification: QualificationStage | null;
  price: number | string | null;
  custom_fields: Record<string, unknown> | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  responsible_user_id: string | null;
  first_seen_at: string;
};

export async function loadDashboardMetrics(
  tenantId: string,
  filters: DashboardFilters,
): Promise<DashboardMetrics> {
  const supabase = await createClient();
  const leads = await fetchAllFilteredLeads<MetricsLeadRow>(
    supabase,
    tenantId,
    filters,
    "qualification, price, custom_fields, utm_source, utm_medium, utm_campaign, responsible_user_id, first_seen_at",
  );

  const rows = applyLeadFilters(leads, filters);
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<
    QualificationStage,
    number
  >;
  let receitaFechada = 0;

  for (const lead of rows) {
    const q = lead.qualification as QualificationStage | null;
    const customFields =
      lead.custom_fields && typeof lead.custom_fields === "object"
        ? (lead.custom_fields as Record<string, unknown>)
        : {};
    const reached = leadReachedStages({
      qualification: q,
      custom_fields: customFields,
    });

    for (const stage of reached) counts[stage] += 1;

    if (q === "venda" && lead.price != null) {
      receitaFechada += Number(lead.price) || 0;
    }
  }

  const leadsTotal = rows.length;
  const taxaConversao =
    leadsTotal > 0 ? Math.round((counts.venda / leadsTotal) * 1000) / 10 : 0;

  return {
    leadsTotal,
    ...counts,
    receitaFechada,
    taxaConversao,
  };
}
