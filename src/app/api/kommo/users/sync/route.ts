import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { canManageTenant, getActiveTenant, requireUser } from "@/lib/auth";
import { dashboardCacheTag } from "@/lib/dashboard-cache";
import { writeAudit } from "@/lib/invites";
import { syncKommoUsers } from "@/lib/kommo/users";
import { takeRateLimit } from "@/lib/rate-limit";

const schema = z.object({ tenant_id: z.string().uuid() });

export async function POST(request: Request) {
  const { userId, supabase } = await requireUser();
  if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const limited = takeRateLimit(`kommo-users-sync:${userId}`, 5, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Aguarde antes de sincronizar novamente." }, { status: 429 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
  }

  const tenantId = parsed.data.tenant_id;
  const membership = await getActiveTenant(userId, tenantId);
  if (!membership || membership.tenant.id !== tenantId || !canManageTenant(membership.role)) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  try {
    const result = await syncKommoUsers(tenantId);
    // Expira imediatamente para que o próximo refresh do dashboard veja os
    // nomes recém-gravados em kommo_users, em vez do stale-while-revalidate
    // do profile "max" (que ainda serviria o mapa anterior à sync).
    revalidateTag(dashboardCacheTag(tenantId), { expire: 0 });
    await writeAudit({
      tenantId,
      action: "kommo.users_sync",
      entityType: "kommo_users",
      metadata: { synced: result.synced, inactive: result.inactive },
      supabase,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error(
      "kommo users sync",
      error instanceof Error ? error.name : "error",
    );
    return NextResponse.json(
      { error: "Não foi possível sincronizar os usuários do Kommo." },
      { status: 502 },
    );
  }
}
