import { NextResponse } from "next/server";
import { z } from "zod";
import { canManageTenant, getActiveTenant, requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/invites";
import { takeRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  tenant_id: z.string().uuid(),
  limit: z.number().int().min(1).max(200).optional(),
});

export async function POST(request: Request) {
  const { userId, supabase } = await requireUser();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const limited = takeRateLimit(`backfill-loss:${userId}`, 6, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Muitas tentativas." }, { status: 429 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  const membership = await getActiveTenant(userId, parsed.data.tenant_id);
  if (!membership || !canManageTenant(membership.role)) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("enqueue_backfill_loss_history", {
    p_tenant_id: parsed.data.tenant_id,
    p_limit: parsed.data.limit ?? 50,
  });

  if (error) {
    return NextResponse.json(
      { error: "Falha ao enfileirar o backfill de histórico." },
      { status: 500 },
    );
  }

  const enqueued = typeof data === "number" ? data : Number(data ?? 0);

  await writeAudit({
    tenantId: parsed.data.tenant_id,
    action: "kommo.backfill_loss_history",
    entityType: "qualification_history",
    metadata: { enqueued, limit: parsed.data.limit ?? 50 },
    supabase,
  });

  return NextResponse.json({ ok: true, enqueued });
}
