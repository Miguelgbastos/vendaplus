import { createClient } from "@/lib/supabase/server";
import {
  isActiveMilestone,
  milestonesForQualification,
} from "@/lib/kommo/normalize";
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

export async function loadDashboardMetrics(
  tenantId: string,
): Promise<DashboardMetrics> {
  const supabase = await createClient();
  const { data: leads } = await supabase
    .from("leads")
    .select("qualification, price, custom_fields")
    .eq("tenant_id", tenantId);

  const rows = leads ?? [];
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
    const reached = new Set(milestonesForQualification(q));

    for (const stage of STAGES) {
      if (
        isActiveMilestone(customFields[stage]) ||
        isActiveMilestone(customFields[stage.toUpperCase()])
      ) {
        reached.add(stage);
      }
    }
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
