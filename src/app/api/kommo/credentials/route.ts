import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, canManageTenant, getActiveTenant } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { normalizeKommoSubdomain } from "@/lib/kommo/subdomain";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  tenant_id: z.string().uuid(),
  subdomain: z.string().min(1),
  integration_id: z.string().min(1).max(200),
  client_secret: z.string().max(500).optional(),
  long_lived_token: z.string().max(5000).optional(),
});

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser();
    if (!userId) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos. Verifique subdomínio, Integration ID e Secret Key." },
        { status: 400 },
      );
    }

    const { tenant_id: tenantId, integration_id: integrationId } = parsed.data;
    const clientSecretInput = parsed.data.client_secret?.trim() || "";
    const longLivedToken = parsed.data.long_lived_token?.trim() || "";

    const membership = await getActiveTenant(userId, tenantId);
    if (!membership || membership.tenant.id !== tenantId) {
      return NextResponse.json({ error: "Sem acesso ao tenant." }, { status: 403 });
    }
    if (!canManageTenant(membership.role)) {
      return NextResponse.json({ error: "Permissão insuficiente." }, { status: 403 });
    }

    const subdomainResult = normalizeKommoSubdomain(parsed.data.subdomain);
    if (!subdomainResult.ok || !subdomainResult.subdomain) {
      return NextResponse.json(
        { error: "Subdomínio inválido. Use minhaempresa ou minhaempresa.kommo.com." },
        { status: 400 },
      );
    }

    const integrationIdClean = integrationId.trim();
    if (!/^[a-zA-Z0-9_-]{8,200}$/.test(integrationIdClean)) {
      return NextResponse.json(
        { error: "Integration ID inválido." },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const { data: existing, error: existingError } = await admin
      .from("kommo_connections")
      .select("id, tenant_id, client_secret_encrypted, status")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (existingError) {
      console.error("kommo credentials load failed");
      return NextResponse.json({ error: "Falha ao salvar configuração." }, { status: 500 });
    }

    if (existing && existing.tenant_id !== tenantId) {
      return NextResponse.json({ error: "Falha ao salvar configuração." }, { status: 500 });
    }

    let secretEncrypted: string | null = null;
    if (clientSecretInput) {
      secretEncrypted = await encryptSecret(clientSecretInput);
    } else if (existing?.client_secret_encrypted) {
      secretEncrypted = existing.client_secret_encrypted;
    } else {
      return NextResponse.json(
        { error: "Informe a Secret Key na primeira configuração." },
        { status: 400 },
      );
    }

    let longLivedTokenEncrypted: string | null | undefined;
    let accountId: string | null | undefined;
    if (longLivedToken) {
      const accountResponse = await fetch(
        `https://${subdomainResult.subdomain}.kommo.com/api/v4/account`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${longLivedToken}`,
          },
        },
      );
      if (!accountResponse.ok) {
        return NextResponse.json(
          { error: "Token de longa duração inválido para esta conta Kommo." },
          { status: 400 },
        );
      }
      const account = (await accountResponse.json()) as { id?: number };
      accountId = account.id != null ? String(account.id) : null;
      longLivedTokenEncrypted = await encryptSecret(longLivedToken);
    }

    const now = new Date().toISOString();
    const payload = {
      tenant_id: tenantId,
      subdomain: subdomainResult.subdomain,
      integration_id: integrationIdClean,
      client_secret_encrypted: secretEncrypted,
      ...(longLivedTokenEncrypted
        ? {
            access_token_encrypted: longLivedTokenEncrypted,
            refresh_token_encrypted: null,
            token_expires_at: null,
            account_id: accountId,
            status: "connected",
            last_error: null,
            connected_at: now,
          }
        : {
            status: existing?.status === "connected" ? "connected" : "pending",
          }),
      updated_at: now,
    };

    const { error: upsertError } = await admin
      .from("kommo_connections")
      .upsert(payload, { onConflict: "tenant_id" });

    if (upsertError) {
      console.error("kommo credentials upsert failed");
      return NextResponse.json({ error: "Falha ao salvar configuração." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      subdomain: subdomainResult.subdomain,
      secret_configured: true,
      integration_configured: true,
      connected: Boolean(longLivedTokenEncrypted),
    });
  } catch (error) {
    console.error(
      "kommo credentials save",
      error instanceof Error ? error.name : "error",
    );
    return NextResponse.json({ error: "Falha ao salvar configuração." }, { status: 500 });
  }
}
