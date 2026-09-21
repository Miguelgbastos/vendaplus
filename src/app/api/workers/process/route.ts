import { NextResponse } from "next/server";
import { timingSafeEqualString } from "@/lib/crypto";
import { getWorkerSecret } from "@/lib/env";
import { runKommoWorker } from "@/lib/jobs/run-kommo-worker";
import { runGweWorker } from "@/lib/gwe/v1/worker";
import { takeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let secret: string;
  try {
    secret = getWorkerSecret();
  } catch {
    return NextResponse.json({ error: "WORKER_SECRET não configurado." }, { status: 500 });
  }

  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !timingSafeEqualString(token, secret)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const limited = takeRateLimit("worker:process", 60, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    limit?: number;
    worker_id?: string;
    tenant_id?: string;
  };
  try {
    const [kommo, gwe] = await Promise.all([
      runKommoWorker({
        limit: body.limit,
        workerId: body.worker_id,
        tenantId: body.tenant_id,
      }),
      runGweWorker({
        limit: body.limit,
        workerId: body.worker_id ? `gwe-${body.worker_id}` : undefined,
      }),
    ]);
    return NextResponse.json({ kommo, gwe });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
