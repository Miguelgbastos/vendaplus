import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, canManageTenant, getActiveTenant } from "@/lib/auth";
import { createOAuthState } from "@/lib/crypto";
import {
  buildKommoAuthorizeUrl,
  loadTenantKommoCredentials,
} from "@/lib/kommo/client";
import { shouldBlockOAuthRetry } from "@/lib/kommo/oauth-exchange";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/env";
import { takeRateLimit } from "@/lib/rate-limit";

const bodySchema = z.object({
  tenant_id: z.string().uuid(),
});

function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser();
    if (!userId) return jsonError("Não autenticado.", 401);

    const limited = takeRateLimit(`kommo-oauth-start:${userId}`, 10, 60_000);
    if (!limited.ok) return jsonError("Muitas tentativas.", 429);

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("Empresa inválida.");

    const tenantId = parsed.data.tenant_id;
    const membership = await getActiveTenant(userId, tenantId);
    if (!membership || membership.tenant.id !== tenantId || !membership.tenant.is_active) {
      return jsonError("Sem permissão.", 403);
    }
    if (!canManageTenant(membership.role)) {
      return jsonError("Sem permissão.", 403);
    }

    let credentials;
    try {
      credentials = await loadTenantKommoCredentials(tenantId);
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (
        code === "kommo_credentials_missing" ||
        code === "kommo_credentials_incomplete"
      ) {
        return jsonError("kommo_not_configured", 400);
      }
      console.error("kommo oauth start credentials", code || "error");
      return jsonError("oauth_failed", 500);
    }

    if (credentials.tenantId !== tenantId) {
      return jsonError("oauth_failed", 500);
    }

    const admin = createAdminClient();
    const { data: connectionMeta } = await admin
      .from("kommo_connections")
      .select("id, tenant_id, last_error, updated_at")
      .eq("tenant_id", tenantId)
      .eq("id", credentials.connectionId)
      .maybeSingle();

    if (
      connectionMeta &&
      connectionMeta.tenant_id === tenantId &&
      shouldBlockOAuthRetry({
        lastError: connectionMeta.last_error,
        updatedAt: connectionMeta.updated_at,
      })
    ) {
      return jsonError("oauth_rate_limited", 429);
    }

    const { error: connectionError } = await admin
      .from("kommo_connections")
      .update({
        status: "pending",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", credentials.connectionId);

    if (connectionError) {
      console.error("kommo_connections status update failed");
      return jsonError("oauth_failed", 500);
    }

    let created;
    try {
      created = createOAuthState({ tenantId, userId });
    } catch {
      console.error("oauth state creation failed");
      return jsonError("oauth_failed", 500);
    }

    const { error: stateError } = await admin.from("oauth_states").insert({
      state_hash: created.stateHash,
      nonce: created.nonce,
      tenant_id: created.tenantId,
      user_id: created.userId,
      expires_at: created.expiresAt,
    });

    if (stateError) {
      console.error("oauth_states insert failed");
      return jsonError("oauth_failed", 500);
    }

    const url = buildKommoAuthorizeUrl({
      state: created.state,
      subdomain: credentials.subdomain,
      integrationId: credentials.integrationId,
    });
    return NextResponse.json({ ok: true, authorize_url: url });
  } catch (error) {
    console.error("kommo oauth start", error instanceof Error ? error.name : "error");
    return jsonError("oauth_failed", 500);
  }
}

/** Compatibilidade: GET apenas informa que o fluxo mudou para POST. */
export async function GET() {
  return NextResponse.json(
    {
      error: "use_post",
      message: "Inicie o OAuth via POST /api/kommo/oauth/start.",
      app: getAppUrl(),
    },
    { status: 405 },
  );
}
