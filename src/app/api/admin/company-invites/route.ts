import { NextResponse } from "next/server";
import { z } from "zod";
import { canManageTenant, getActiveTenant, requireUser } from "@/lib/auth";
import {
  createInviteToken,
  hashInviteToken,
  inviteAcceptUrl,
  writeAudit,
} from "@/lib/invites";
import { takeRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const listSchema = z.object({ company_id: z.string().uuid() });
const inviteIdSchema = z.object({
  company_id: z.string().uuid(),
  invite_id: z.string().uuid(),
});

async function authorize(userId: string, companyId: string) {
  const membership = await getActiveTenant(userId, companyId);
  if (!membership || !canManageTenant(membership.role)) return null;
  return membership;
}

export async function GET(request: Request) {
  const { userId } = await requireUser();
  if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const parsed = listSchema.safeParse({ company_id: searchParams.get("company_id") });
  if (!parsed.success) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
  if (!(await authorize(userId, parsed.data.company_id))) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenant_invites")
    .select("id, email, role, status, expires_at, last_sent_at, created_at")
    .eq("tenant_id", parsed.data.company_id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: "Falha ao listar convites." }, { status: 500 });
  return NextResponse.json({ invites: data ?? [] });
}

export async function PATCH(request: Request) {
  try {
    const { userId, supabase } = await requireUser();
    if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const limited = takeRateLimit(`company-invites:resend:${userId}`, 10, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Muitas tentativas." }, { status: 429 });
    }
    const parsed = inviteIdSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    if (!(await authorize(userId, parsed.data.company_id))) {
      return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: invite, error } = await admin
      .from("tenant_invites")
      .select("id, email, role, status, expires_at")
      .eq("id", parsed.data.invite_id)
      .eq("tenant_id", parsed.data.company_id)
      .maybeSingle();
    if (error || !invite) return NextResponse.json({ error: "Convite não encontrado." }, { status: 404 });
    if (invite.status !== "pending") {
      return NextResponse.json({ error: "Somente convites pendentes podem ser reenviados." }, { status: 409 });
    }

    const { token, tokenHash } = createInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: updateError } = await admin
      .from("tenant_invites")
      .update({
        token_hash: tokenHash,
        expires_at: expiresAt,
        last_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", invite.id);
    if (updateError) return NextResponse.json({ error: "Falha ao renovar convite." }, { status: 500 });

    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(invite.email, {
      redirectTo: inviteAcceptUrl(token),
      data: { invite_tenant_id: parsed.data.company_id, invite_role: invite.role },
    });

    await writeAudit({
      tenantId: parsed.data.company_id,
      action: "invite.resend",
      entityType: "tenant_invites",
      entityId: invite.id,
      metadata: { email: invite.email, email_sent: !inviteError },
      supabase,
    });

    return NextResponse.json({ ok: true, email_sent: !inviteError });
  } catch (error) {
    console.error("invite resend", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "Não foi possível reenviar o convite." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { userId, supabase } = await requireUser();
    if (!userId) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    const parsed = inviteIdSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    if (!(await authorize(userId, parsed.data.company_id))) {
      return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: invite } = await admin
      .from("tenant_invites")
      .select("id, status")
      .eq("id", parsed.data.invite_id)
      .eq("tenant_id", parsed.data.company_id)
      .maybeSingle();
    if (!invite) return NextResponse.json({ error: "Convite não encontrado." }, { status: 404 });
    if (invite.status !== "pending") {
      return NextResponse.json({ error: "Somente convites pendentes podem ser cancelados." }, { status: 409 });
    }

    const { error } = await admin
      .from("tenant_invites")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        // Invalidate token.
        token_hash: hashInviteToken(`cancelled:${invite.id}:${Date.now()}`),
        updated_at: new Date().toISOString(),
      })
      .eq("id", invite.id);
    if (error) return NextResponse.json({ error: "Falha ao cancelar." }, { status: 500 });

    await writeAudit({
      tenantId: parsed.data.company_id,
      action: "invite.cancel",
      entityType: "tenant_invites",
      entityId: invite.id,
      supabase,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("invite cancel", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "Não foi possível cancelar o convite." }, { status: 500 });
  }
}
