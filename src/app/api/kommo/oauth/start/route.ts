import { NextResponse } from "next/server";
import { requireUser, canManageTenant, getActiveTenant } from "@/lib/auth";
import { createOAuthState } from "@/lib/crypto";
import {
  buildKommoAuthorizeUrl,
  loadTenantKommoCredentials,
} from "@/lib/kommo/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/env";

function redirectKommo(error?: string) {
  const url = new URL("/kommo", getAppUrl());
  if (error) url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  try {
    const { userId } = await requireUser();
    if (!userId) {
      return NextResponse.redirect(new URL("/login?next=/kommo", getAppUrl()));
    }

    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenant_id");

    if (!tenantId) {
      return redirectKommo("oauth_missing");
    }

    const membership = await getActiveTenant(userId, tenantId);
    if (!membership || membership.tenant.id !== tenantId) {
      return redirectKommo("oauth_failed");
    }
    if (!canManageTenant(membership.role)) {
      return redirectKommo("oauth_failed");
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
        return redirectKommo("kommo_not_configured");
      }
      console.error("kommo oauth start credentials", code || "error");
      return redirectKommo("oauth_failed");
    }

    if (credentials.tenantId !== tenantId) {
      return redirectKommo("oauth_failed");
    }

    const admin = createAdminClient();
    const { error: connectionError } = await admin
      .from("kommo_connections")
      .update({
        status: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", credentials.connectionId);

    if (connectionError) {
      console.error("kommo_connections status update failed");
      return redirectKommo("oauth_failed");
    }

    let created;
    try {
      created = createOAuthState({ tenantId, userId });
    } catch {
      console.error("oauth state creation failed");
      return redirectKommo("oauth_failed");
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
      return redirectKommo("oauth_failed");
    }

    const url = buildKommoAuthorizeUrl({
      state: created.state,
      subdomain: credentials.subdomain,
      integrationId: credentials.integrationId,
    });
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("kommo oauth start", error instanceof Error ? error.name : "error");
    return redirectKommo("oauth_failed");
  }
}
