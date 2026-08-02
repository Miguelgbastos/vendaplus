import { NextResponse } from "next/server";
import { z } from "zod";
import { canManageTenant, getActiveTenant, requireUser } from "@/lib/auth";
import { rolesAssignableBy } from "@/lib/company-user-permissions";

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
  if (message.includes("user_not_found")) return ["Nenhum usuário cadastrado foi encontrado com esse e-mail.", 404] as const;
  if (message.includes("duplicate key")) return ["Esse usuário já possui acesso à empresa.", 409] as const;
  if (message.includes("last_owner")) return ["A empresa precisa manter pelo menos um proprietário.", 409] as const;
  if (message.includes("permission") || message.includes("not_allowed")) return ["Você não pode alterar esse acesso.", 403] as const;
  return ["Não foi possível salvar a alteração.", 500] as const;
}

export async function POST(request: Request) {
  try {
    const { userId, supabase } = await requireUser();
    if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const parsed = addSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "E-mail, empresa ou papel inválido." }, { status: 400 });

    const actor = await authorize(userId, parsed.data.company_id);
    if (!actor) return NextResponse.json({ error: "Sem permissão para administrar esta empresa." }, { status: 403 });
    if (!rolesAssignableBy(actor.role).includes(parsed.data.role)) {
      return NextResponse.json({ error: "Somente um proprietário pode conceder esse papel." }, { status: 403 });
    }

    const { error } = await supabase.rpc("manage_company_user", {
      p_action: "add", p_tenant_id: parsed.data.company_id, p_email: parsed.data.email,
      p_membership_id: null, p_role: parsed.data.role,
    });
    if (error) { const [message, status] = mutationError(error.message); return NextResponse.json({ error: message }, { status }); }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("company user add", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "Não foi possível adicionar o acesso." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { userId, supabase } = await requireUser();
    if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const parsed = changeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    if (!await authorize(userId, parsed.data.company_id)) return NextResponse.json({ error: "Sem permissão para administrar esta empresa." }, { status: 403 });
    const { error } = await supabase.rpc("manage_company_user", { p_action: "update", p_tenant_id: parsed.data.company_id, p_email: null, p_membership_id: parsed.data.membership_id, p_role: parsed.data.role });
    if (error) { const [message, status] = mutationError(error.message); return NextResponse.json({ error: message }, { status }); }
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
    if (!await authorize(userId, parsed.data.company_id)) return NextResponse.json({ error: "Sem permissão para administrar esta empresa." }, { status: 403 });
    const { error } = await supabase.rpc("manage_company_user", { p_action: "remove", p_tenant_id: parsed.data.company_id, p_email: null, p_membership_id: parsed.data.membership_id, p_role: null });
    if (error) { const [message, status] = mutationError(error.message); return NextResponse.json({ error: message }, { status }); }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("company user remove", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "Não foi possível remover o acesso." }, { status: 500 });
  }
}
