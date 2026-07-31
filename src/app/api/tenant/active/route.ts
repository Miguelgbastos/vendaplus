import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserMemberships, requireUser } from "@/lib/auth";
import { resolveActiveMembership } from "@/lib/resolve-active-membership";
import { setActiveTenantCookie } from "@/lib/tenant-cookie";

const bodySchema = z.object({
  tenant_id: z.string().uuid(),
});

export async function POST(request: Request) {
  const { userId } = await requireUser();
  if (!userId) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "tenant_id inválido." }, { status: 400 });
  }

  const tenantId = parsed.data.tenant_id;
  const memberships = await getUserMemberships(userId);
  const match = resolveActiveMembership(memberships, tenantId, {
    allowFallback: false,
  });

  if (!match?.tenants) {
    return NextResponse.json(
      { error: "Organização inválida ou sem permissão." },
      { status: 403 },
    );
  }

  await setActiveTenantCookie(match.tenants.id);

  return NextResponse.json({
    ok: true,
    tenant: {
      id: match.tenants.id,
      name: match.tenants.name,
      slug: match.tenants.slug,
    },
  });
}
