import { createClient } from "@/lib/supabase/server";
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
    .select("qualification, price")
    .eq("tenant_id", tenantId);

  const rows = leads ?? [];
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<
    QualificationStage,
    number
  >;
  let receitaFechada = 0;

  for (const lead of rows) {
    const q = lead.qualification as QualificationStage | null;
    if (q && counts[q] != null) counts[q] += 1;
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
