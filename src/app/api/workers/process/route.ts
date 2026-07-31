import { NextResponse } from "next/server";
import { timingSafeEqualString } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { failJob, processKommoJob } from "@/lib/kommo/process";

export const runtime = "nodejs";
export const maxDuration = 60;

type ClaimedJob = {
  id: string;
  tenant_id: string;
  raw_event_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  job_type: string;
};

export async function POST(request: Request) {
  const secret = process.env.WORKER_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "WORKER_SECRET não configurado." }, { status: 500 });
  }

  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !timingSafeEqualString(token, secret)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    limit?: number;
    worker_id?: string;
  };
  const limit = Math.min(Math.max(body.limit ?? 10, 1), 50);
  const workerId = body.worker_id || `worker-${process.pid}`;

  const admin = createAdminClient();
  const { data: jobs, error } = await admin.rpc("claim_jobs", {
    p_limit: limit,
    p_worker_id: workerId,
    p_job_types: ["process_kommo_event"],
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const claimed = (jobs ?? []) as ClaimedJob[];
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const job of claimed) {
    try {
      if (job.job_type === "process_kommo_event") {
        await processKommoJob(job);
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

  return NextResponse.json({
    claimed: claimed.length,
    results,
  });
}
