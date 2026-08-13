import { NextResponse } from "next/server";
import { z } from "zod";
import { canManageTenant, getActiveTenant, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/invites";
import { takeRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  company_id: z.string().uuid(),
  limit: z.number().int().min(1).max(100).optional(),
});

export async function POST(request: Request) {
  const { userId, supabase } = await requireUser();
  if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const limited = takeRateLimit(`replay-dead:${userId}`, 10, 60_000);
  if (!limited.ok) return NextResponse.json({ error: "Muitas tentativas." }, { status: 429 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });

  const membership = await getActiveTenant(userId, parsed.data.company_id);
  if (!membership || !canManageTenant(membership.role)) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("replay_dead_jobs", {
    p_tenant_id: parsed.data.company_id,
    p_limit: parsed.data.limit ?? 20,
    p_job_types: null,
  });
  if (error) {
    return NextResponse.json({ error: "Falha ao reenfileirar jobs." }, { status: 500 });
  }

  await writeAudit({
    tenantId: parsed.data.company_id,
    action: "jobs.replay_dead",
    entityType: "jobs",
    metadata: { replayed: data },
    supabase,
  });

  return NextResponse.json({ ok: true, replayed: data ?? 0 });
}
