import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeGwePayload, validateGwePayload } from "./validation.ts";

type ClaimedOutbox = {
  raw_event_id: string;
};

type RawEvent = {
  id: string;
  tenant_id: string;
  connection_id: string | null;
  provider: string;
  payload: unknown;
};

export async function runGweWorker(options?: {
  limit?: number;
  workerId?: string;
  leaseSeconds?: number;
}) {
  const limit = Math.min(Math.max(options?.limit ?? 10, 1), 50);
  const workerId = options?.workerId || `gwe-worker-${process.pid}`;
  const admin = createAdminClient();
  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_processing_outbox",
    {
      p_limit: limit,
      p_worker_id: workerId,
      p_lease_seconds: options?.leaseSeconds ?? 300,
    },
  );
  if (claimError) throw new Error(claimError.message);

  const results: Array<{ rawEventId: string; ok: boolean; outcome?: string; error?: string }> = [];
  for (const item of (claimed ?? []) as ClaimedOutbox[]) {
    try {
      const { data: rawEvent, error: rawError } = await admin
        .from("raw_events")
        .select("id, tenant_id, connection_id, provider, payload")
        .eq("id", item.raw_event_id)
        .single();
      if (rawError || !rawEvent || !rawEvent.connection_id) {
        throw new Error(rawError?.message ?? "gwe_raw_event_connection_missing");
      }

      const event = rawEvent as RawEvent;
      const connectionId = event.connection_id;
      if (!connectionId) throw new Error("gwe_raw_event_connection_missing");
      const payload = validateGwePayload(event.payload);
      const snapshot = normalizeGwePayload(payload, {
        tenantId: event.tenant_id,
        connectionId,
        provider: event.provider,
      });
      const { data: result, error: reconcileError } = await admin.rpc(
        "reconcile_crm_lead_snapshot",
        {
          p_raw_event_id: event.id,
          p_snapshot: snapshot,
        },
      );
      if (reconcileError) throw new Error(reconcileError.message);

      const row = Array.isArray(result) ? result[0] : result;
      results.push({
        rawEventId: event.id,
        ok: true,
        outcome: row?.outcome,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await admin.rpc("fail_processing_outbox", {
        p_raw_event_id: item.raw_event_id,
        p_error_code: "gwe_processing_failed",
        p_error_message: message.slice(0, 1000),
      });
      results.push({ rawEventId: item.raw_event_id, ok: false, error: message });
    }
  }

  return { claimed: (claimed ?? []).length, results };
}
