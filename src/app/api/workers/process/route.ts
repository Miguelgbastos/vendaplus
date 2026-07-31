import { NextResponse } from "next/server";
import { timingSafeEqualString } from "@/lib/crypto";
import { runKommoWorker } from "@/lib/jobs/run-kommo-worker";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  try {
    const result = await runKommoWorker({
      limit: body.limit,
      workerId: body.worker_id,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
