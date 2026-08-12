import { createAdminClient } from "@/lib/supabase/admin";
import type { QualificationStage } from "@/types/database";

export type MetaCapiJobPayload = {
  lead_id: string;
  qualification: QualificationStage;
  occurred_at: string;
};

/**
 * Cria um job `send_meta_capi_event` para envio assíncrono ao Meta.
 * Não bloqueia o processamento de leads e permite retries próprios.
 */
export async function enqueueMetaCapiEvent(
  tenantId: string,
  payload: MetaCapiJobPayload,
): Promise<void> {
  const admin = createAdminClient();
  await admin.from("jobs").insert({
    tenant_id: tenantId,
    job_type: "send_meta_capi_event",
    status: "pending",
    payload: payload as unknown as Record<string, unknown>,
    max_attempts: 5,
  });
}
