import type { QualificationStage } from "@/types/database";

export type MetaCapiJobPayload = {
  lead_id: string;
  qualification: QualificationStage;
  occurred_at: string;
};

export type MetaCapiEnqueueResult = {
  enqueued: false;
  reason: "database_outbox";
};

/**
 * Compatibility shim.
 *
 * O enqueue real passou para um trigger PostgreSQL em qualification_history.
 * Dessa forma, histórico + job CAPI são persistidos na mesma transação e não há
 * janela de perda entre duas chamadas Supabase. Mantemos esta função enquanto o
 * processador Kommo ainda chama o helper; ela não realiza I/O nem cria jobs.
 */
export async function enqueueMetaCapiEvent(
  _tenantId: string,
  _payload: MetaCapiJobPayload,
): Promise<MetaCapiEnqueueResult> {
  return { enqueued: false, reason: "database_outbox" };
}
