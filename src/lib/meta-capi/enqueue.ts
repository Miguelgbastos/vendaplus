import { generateEventId } from "@/lib/meta-capi/event";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QualificationStage } from "@/types/database";

export type MetaCapiJobPayload = {
  lead_id: string;
  qualification: QualificationStage;
  occurred_at: string;
};

export type MetaCapiEnqueueResult =
  | { enqueued: true; eventId: string }
  | { enqueued: false; reason: "disabled_or_not_configured" | "no_active_mapping" };

/**
 * Cria um job `send_meta_capi_event` somente quando a empresa possui CAPI ativa
 * e um mapping ativo para a qualificação. O event_id nasce no enqueue e fica
 * persistido no payload para ser reutilizado por todos os retries.
 */
export async function enqueueMetaCapiEvent(
  tenantId: string,
  payload: MetaCapiJobPayload,
): Promise<MetaCapiEnqueueResult> {
  const admin = createAdminClient();

  const { data: connection, error: connectionError } = await admin
    .from("meta_capi_connections")
    .select("is_enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (connectionError) {
    throw new Error(`meta_capi_connection_lookup_failed:${connectionError.message}`);
  }
  if (!connection?.is_enabled) {
    return { enqueued: false, reason: "disabled_or_not_configured" };
  }

  const { data: mapping, error: mappingError } = await admin
    .from("meta_capi_event_mappings")
    .select("is_active")
    .eq("tenant_id", tenantId)
    .eq("qualification", payload.qualification)
    .maybeSingle();

  if (mappingError) {
    throw new Error(`meta_capi_mapping_lookup_failed:${mappingError.message}`);
  }
  if (!mapping?.is_active) {
    return { enqueued: false, reason: "no_active_mapping" };
  }

  const eventId = generateEventId();
  const jobPayload = {
    ...payload,
    event_id: eventId,
  };

  const { error: insertError } = await admin.from("jobs").insert({
    tenant_id: tenantId,
    job_type: "send_meta_capi_event",
    status: "pending",
    priority: 200,
    payload: jobPayload as unknown as Record<string, unknown>,
    max_attempts: 5,
  });

  if (insertError) {
    throw new Error(`meta_capi_job_insert_failed:${insertError.message}`);
  }

  return { enqueued: true, eventId };
}
