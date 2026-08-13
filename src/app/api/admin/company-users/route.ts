import { NextResponse } from "next/server";
import { z } from "zod";
import { canManageTenant, getActiveTenant, requireUser } from "@/lib/auth";
import { rolesAssignableBy } from "@/lib/company-user-permissions";
import { inviteOrAddCompanyUser, writeAudit } from "@/lib/invites";
import { takeRateLimit } from "@/lib/rate-limit";

const roleSchema = z.enum(["owner", "admin", "analyst", "viewer"]);
const addSchema = z.object({
  company_id: z.string().uuid(),
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  role: roleSchema,
});
const changeSchema = z.object({
  company_id: z.string().uuid(),
  membership_id: z.string().uuid(),
  role: roleSchema,
});
const removeSchema = z.object({
  company_id: z.string().uuid(),
  membership_id: z.string().uuid(),
});

async function authorize(userId: string, companyId: string) {
  const membership = await getActiveTenant(userId, companyId);
  if (!membership || !canManageTenant(membership.role)) return null;
  return membership;
}

function mutationError(message: string) {
  if (message.includes("user_not_found")) {
    return ["Nenhum usuário cadastrado foi encontrado com esse e-mail.", 404] as const;
  }
  if (message.includes("invite_already_pending")) {
    return ["Já existe um convite pendente para este e-mail.", 409] as const;
  }
  if (message.includes("duplicate key")) {
    return ["Esse usuário já possui acesso à empresa.", 409] as const;
  }
  if (message.includes("last_owner")) {
    return ["A empresa precisa manter pelo menos um proprietário.", 409] as const;
  }
  if (message.includes("permission") || message.includes("not_allowed")) {
    return ["Você não pode alterar esse acesso.", 403] as const;
  }
  return ["Não foi possível salvar a alteração.", 500] as const;
}

export async function POST(request: Request) {
  try {
    const { userId, supabase } = await requireUser();
    if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

    const limited = takeRateLimit(`company-users:add:${userId}`, 20, 60_000);
    if (!limited.ok) {
      return NextResponse.json(
        { error: "Muitas tentativas. Aguarde e tente novamente." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
      );
    }

    const parsed = addSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "E-mail, empresa ou papel inválido." }, { status: 400 });
    }

    const actor = await authorize(userId, parsed.data.company_id);
    if (!actor) {
      return NextResponse.json({ error: "Sem permissão para administrar esta empresa." }, { status: 403 });
    }
    if (!rolesAssignableBy(actor.role).includes(parsed.data.role)) {
      return NextResponse.json(
        { error: "Somente um proprietário pode conceder esse papel." },
        { status: 403 },
      );
    }

    const result = await inviteOrAddCompanyUser({
      tenantId: parsed.data.company_id,
      email: parsed.data.email,
      role: parsed.data.role,
      actorUserId: userId,
      userClient: supabase,
    });

    if (result.kind === "membership") {
      return NextResponse.json({ ok: true, mode: "membership" });
    }
    return NextResponse.json({
      ok: true,
      mode: "invite",
      invite_id: result.inviteId,
      email_sent: result.emailSent,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "error";
    console.error("company user add", message);
    const [body, status] = mutationError(message);
    return NextResponse.json({ error: body }, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const { userId, supabase } = await requireUser();
    if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const parsed = changeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    const actor = await authorize(userId, parsed.data.company_id);
    if (!actor) {
      return NextResponse.json({ error: "Sem permissão para administrar esta empresa." }, { status: 403 });
    }
    if (!rolesAssignableBy(actor.role).includes(parsed.data.role)) {
      return NextResponse.json(
        { error: "Somente um proprietário pode conceder esse papel." },
        { status: 403 },
      );
    }
    const { error } = await supabase.rpc("manage_company_user", {
      p_action: "update",
      p_tenant_id: parsed.data.company_id,
      p_email: null,
      p_membership_id: parsed.data.membership_id,
      p_role: parsed.data.role,
    });
    if (error) {
      const [message, status] = mutationError(error.message);
      return NextResponse.json({ error: message }, { status });
    }
    await writeAudit({
      tenantId: parsed.data.company_id,
      action: "membership.update",
      entityType: "tenant_users",
      entityId: parsed.data.membership_id,
      metadata: { role: parsed.data.role },
      supabase,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("company user update", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "Não foi possível alterar o acesso." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { userId, supabase } = await requireUser();
    if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const parsed = removeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    if (!(await authorize(userId, parsed.data.company_id))) {
      return NextResponse.json({ error: "Sem permissão para administrar esta empresa." }, { status: 403 });
    }
    const { error } = await supabase.rpc("manage_company_user", {
      p_action: "remove",
      p_tenant_id: parsed.data.company_id,
      p_email: null,
      p_membership_id: parsed.data.membership_id,
      p_role: null,
    });
    if (error) {
      const [message, status] = mutationError(error.message);
      return NextResponse.json({ error: message }, { status });
    }
    await writeAudit({
      tenantId: parsed.data.company_id,
      action: "membership.remove",
      entityType: "tenant_users",
      entityId: parsed.data.membership_id,
      supabase,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("company user remove", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "Não foi possível remover o acesso." }, { status: 500 });
  }
}
