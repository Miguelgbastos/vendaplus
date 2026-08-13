import { createAdminClient } from "@/lib/supabase/admin";
import { failJob, processKommoJob } from "@/lib/kommo/process";
import { processMetaCapiJob } from "@/lib/meta-capi/process";

type ClaimedJob = {
  id: string;
  tenant_id: string;
  raw_event_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  job_type: string;
};

export async function runKommoWorker(options?: {
  limit?: number;
  workerId?: string;
  tenantId?: string;
  leaseSeconds?: number;
}) {
  const limit = Math.min(Math.max(options?.limit ?? 10, 1), 50);
  const workerId = options?.workerId || `worker-${process.pid}`;
  const admin = createAdminClient();
  const { data: jobs, error } = await admin.rpc("claim_jobs", {
    p_limit: limit,
    p_worker_id: workerId,
    p_job_types: ["process_kommo_event", "send_meta_capi_event"],
    p_tenant_id: options?.tenantId ?? null,
    p_lease_seconds: options?.leaseSeconds ?? 300,
  });

  if (error) {
    throw new Error(error.message);
  }

  const claimed = (jobs ?? []) as ClaimedJob[];
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const job of claimed) {
    try {
      if (job.job_type === "process_kommo_event") {
        await processKommoJob(job);
      } else if (job.job_type === "send_meta_capi_event") {
        await processMetaCapiJob(job);
      }
      results.push({ id: job.id, ok: true });
    } catch (err) {
      await failJob(job, err);
      results.push({
        id: job.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    claimed: claimed.length,
    results,
  };
}
