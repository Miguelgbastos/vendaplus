import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  encryptSecret,
  randomWebhookToken,
  sha256Hex,
  verifyOAuthState,
} from "@/lib/crypto";
import {
  exchangeKommoCode,
  loadTenantKommoCredentials,
} from "@/lib/kommo/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/env";
import { canManageTenant, getActiveTenant, requireUser } from "@/lib/auth";
import { normalizeKommoSubdomain } from "@/lib/kommo/subdomain";
import { syncKommoUsers } from "@/lib/kommo/users";
import { dashboardCacheTag } from "@/lib/dashboard-cache";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const referer = searchParams.get("referer");
  const appUrl = getAppUrl();
  let callbackTenantId: string | null = null;

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/kommo?error=oauth_missing`);
  }

  try {
    const { userId: sessionUserId } = await requireUser();
    if (!sessionUserId) {
      return NextResponse.redirect(`${appUrl}/login?next=/kommo`);
    }

    const payload = verifyOAuthState(state);
    callbackTenantId = payload.tenantId;
    if (payload.userId !== sessionUserId) {
      return NextResponse.redirect(`${appUrl}/kommo?error=oauth_user_mismatch`);
    }

    const membership = await getActiveTenant(sessionUserId, payload.tenantId);
    if (
      !membership ||
      membership.tenant.id !== payload.tenantId ||
      !membership.tenant.is_active ||
      !canManageTenant(membership.role)
    ) {
      return NextResponse.redirect(`${appUrl}/kommo?error=oauth_forbidden`);
    }

    const stateHash = sha256Hex(state);
    const admin = createAdminClient();

    const { data: consumed, error: consumeError } = await admin.rpc(
      "consume_oauth_state",
      {
        p_state_hash: stateHash,
        p_tenant_id: payload.tenantId,
        p_user_id: payload.userId,
      },
    );

    if (consumeError || consumed !== true) {
      return NextResponse.redirect(`${appUrl}/kommo?error=oauth_state_used`);
    }

    const credentials = await loadTenantKommoCredentials(payload.tenantId);
    if (credentials.tenantId !== payload.tenantId) {
      return NextResponse.redirect(`${appUrl}/kommo?error=oauth_failed`);
    }

    const normalizedReferer = normalizeKommoSubdomain(referer);
    if (
      !normalizedReferer.ok ||
      !normalizedReferer.subdomain ||
      normalizedReferer.subdomain !== credentials.subdomain
    ) {
      await admin
        .from("kommo_connections")
        .update({
          status: "error",
          last_error: "kommo_oauth_account_mismatch",
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", payload.tenantId)
        .eq("id", credentials.connectionId);
      return NextResponse.redirect(
        `${appUrl}/kommo?error=oauth_account_mismatch`,
      );
    }

    const tokens = await exchangeKommoCode({
      code,
      subdomain: normalizedReferer.subdomain,
      integrationId: credentials.integrationId,
      clientSecret: credentials.clientSecret,
    });

    const accessEnc = await encryptSecret(tokens.access_token);
    const refreshEnc = await encryptSecret(tokens.refresh_token);
    const tokenExpiresAt = new Date(
      Date.now() + tokens.expires_in * 1000,
    ).toISOString();

    let accountId: string | null = null;
    try {
      const accountRes = await fetch(
        `https://${normalizedReferer.subdomain}.kommo.com/api/v4/account`,
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      if (accountRes.ok) {
        const account = (await accountRes.json()) as { id?: number };
        accountId = account.id != null ? String(account.id) : null;
      }
    } catch {
      // conta opcional — não falha o OAuth
    }

    const { error: updateError } = await admin
      .from("kommo_connections")
      .update({
        account_id: accountId,
        access_token_encrypted: accessEnc,
        refresh_token_encrypted: refreshEnc,
        token_expires_at: tokenExpiresAt,
        status: "connected",
        last_error: null,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", payload.tenantId)
      .eq("id", credentials.connectionId);

    if (updateError) {
      console.error("kommo oauth callback update failed");
      return NextResponse.redirect(`${appUrl}/kommo?error=oauth_failed`);
    }

    const { data: existingWebhook } = await admin
      .from("webhook_endpoints")
      .select("id")
      .eq("tenant_id", payload.tenantId)
      .maybeSingle();

    if (!existingWebhook) {
      await admin.from("webhook_endpoints").insert({
        tenant_id: payload.tenantId,
        token: randomWebhookToken(),
        is_active: true,
      });
    }

    let usersSync = "ok";
    try {
      await syncKommoUsers(payload.tenantId);
      revalidateTag(dashboardCacheTag(payload.tenantId), "max");
    } catch (syncError) {
      usersSync = "failed";
      console.warn(
        "kommo users initial sync",
        syncError instanceof Error ? syncError.name : "error",
      );
    }

    return NextResponse.redirect(
      `${appUrl}/kommo?connected=1&users_sync=${usersSync}`,
    );
  } catch (error) {
    const safeError =
      error instanceof Error && error.message.startsWith("kommo_oauth_exchange_")
        ? error.message
        : "kommo_oauth_callback_failed";
    if (callbackTenantId) {
      const admin = createAdminClient();
      await admin
        .from("kommo_connections")
        .update({
          status: "error",
          last_error: safeError,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", callbackTenantId);
    }
    console.error(
      "kommo oauth callback",
      safeError,
    );
    return NextResponse.redirect(
      `${appUrl}/kommo?error=${safeError.startsWith("kommo_oauth_exchange_") ? "oauth_exchange_failed" : "oauth_failed"}`,
    );
  }
}
