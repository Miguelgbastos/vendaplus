import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getKommoRedirectUri } from "@/lib/env";
import { buildKommoApiUrl } from "@/lib/kommo/api-url";
import {
  assertKommoTokenResponse,
  formatKommoOAuthExchangeError,
  type KommoTokenResponse,
} from "@/lib/kommo/oauth-exchange";

export { buildKommoApiUrl };

export type { KommoTokenResponse };

export type TenantKommoCredentials = {
  connectionId: string;
  tenantId: string;
  subdomain: string;
  integrationId: string;
  clientSecret: string;
};

type ConnectionSecretsRow = {
  id: string;
  tenant_id: string;
  subdomain: string | null;
  integration_id: string | null;
  client_secret_encrypted: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
};

/**
 * Carrega credenciais da integração privada do tenant.
 * Sempre filtra por tenant_id e valida o retorno para evitar mistura entre tenants.
 */
export async function loadTenantKommoCredentials(
  tenantId: string,
): Promise<TenantKommoCredentials> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("kommo_connections")
    .select(
      "id, tenant_id, subdomain, integration_id, client_secret_encrypted, access_token_encrypted, refresh_token_encrypted, token_expires_at",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("kommo_credentials_missing");
  }

  const row = data as ConnectionSecretsRow;
  if (row.tenant_id !== tenantId) {
    throw new Error("kommo_tenant_mismatch");
  }

  if (!row.subdomain || !row.integration_id || !row.client_secret_encrypted) {
    throw new Error("kommo_credentials_incomplete");
  }

  const clientSecret = await decryptSecret(row.client_secret_encrypted);

  return {
    connectionId: row.id,
    tenantId: row.tenant_id,
    subdomain: row.subdomain,
    integrationId: row.integration_id,
    clientSecret,
  };
}

export function buildKommoAuthorizeUrl(params: {
  state: string;
  subdomain: string;
  integrationId: string;
  redirectUri?: string;
}) {
  const redirectUri = params.redirectUri || getKommoRedirectUri();
  // Kommo's account picker and consent screen always live on the central
  // OAuth host. The tenant subdomain is used only for API/token requests.
  const url = new URL("https://www.kommo.com/oauth");
  url.searchParams.set("client_id", params.integrationId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", params.state);
  return url.toString();
}

export async function exchangeKommoCode(params: {
  code: string;
  subdomain: string;
  integrationId: string;
  clientSecret: string;
  redirectUri?: string;
}): Promise<KommoTokenResponse> {
  const redirectUri = params.redirectUri || getKommoRedirectUri();
  const res = await fetch(
    `https://${params.subdomain}.kommo.com/oauth2/access_token`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: params.integrationId,
        client_secret: params.clientSecret,
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: redirectUri,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(formatKommoOAuthExchangeError(res.status, body, res.headers));
  }
  const json: unknown = await res.json();
  return assertKommoTokenResponse(json);
}

export async function refreshKommoToken(params: {
  refreshToken: string;
  subdomain: string;
  integrationId: string;
  clientSecret: string;
  redirectUri?: string;
}): Promise<KommoTokenResponse> {
  const redirectUri = params.redirectUri || getKommoRedirectUri();
  const res = await fetch(
    `https://${params.subdomain}.kommo.com/oauth2/access_token`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: params.integrationId,
        client_secret: params.clientSecret,
        grant_type: "refresh_token",
        refresh_token: params.refreshToken,
        redirect_uri: redirectUri,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(formatKommoOAuthExchangeError(res.status, body, res.headers));
  }
  const json: unknown = await res.json();
  return assertKommoTokenResponse(json);
}

export async function getValidAccessToken(tenantId: string): Promise<{
  accessToken: string;
  subdomain: string;
  connectionId: string;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("kommo_connections")
    .select(
      "id, tenant_id, subdomain, integration_id, client_secret_encrypted, access_token_encrypted, refresh_token_encrypted, token_expires_at",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Conexão Kommo não encontrada para a empresa.");
  }

  const connection = data as ConnectionSecretsRow;
  if (connection.tenant_id !== tenantId) {
    throw new Error("kommo_tenant_mismatch");
  }
  if (!connection.subdomain) {
    throw new Error("Subdomínio Kommo ausente.");
  }
  if (!connection.integration_id || !connection.client_secret_encrypted) {
    throw new Error("Credenciais da integração Kommo ausentes.");
  }
  if (!connection.access_token_encrypted) {
    throw new Error("Token Kommo ausente.");
  }

  if (!connection.refresh_token_encrypted) {
    return {
      accessToken: await decryptSecret(connection.access_token_encrypted),
      subdomain: connection.subdomain,
      connectionId: connection.id,
    };
  }

  const expiresAt = connection.token_expires_at
    ? Date.parse(connection.token_expires_at)
    : 0;
  const needsRefresh = !expiresAt || expiresAt < Date.now() + 60_000;

  if (!needsRefresh) {
    return {
      accessToken: await decryptSecret(connection.access_token_encrypted),
      subdomain: connection.subdomain,
      connectionId: connection.id,
    };
  }

  // Compare-and-swap: only one worker refreshes for a given expiry snapshot.
  const expectedExpiresAt = connection.token_expires_at;
  const refreshToken = await decryptSecret(connection.refresh_token_encrypted);
  const clientSecret = await decryptSecret(connection.client_secret_encrypted);
  const tokens = await refreshKommoToken({
    refreshToken,
    subdomain: connection.subdomain,
    integrationId: connection.integration_id,
    clientSecret,
  });
  const accessEnc = await encryptSecret(tokens.access_token);
  const refreshEnc = await encryptSecret(tokens.refresh_token);
  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  let updateQuery = admin
    .from("kommo_connections")
    .update({
      access_token_encrypted: accessEnc,
      refresh_token_encrypted: refreshEnc,
      token_expires_at: tokenExpiresAt,
      status: "connected",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id)
    .eq("tenant_id", tenantId);

  if (expectedExpiresAt) {
    updateQuery = updateQuery.eq("token_expires_at", expectedExpiresAt);
  } else {
    updateQuery = updateQuery.is("token_expires_at", null);
  }

  const { data: updated, error: updateError } = await updateQuery
    .select("id")
    .maybeSingle();

  if (updateError) {
    throw new Error("Falha ao atualizar tokens Kommo.");
  }

  if (!updated) {
    // Outro worker venceu o refresh — releia o token atual.
    const { data: latest } = await admin
      .from("kommo_connections")
      .select("access_token_encrypted, subdomain")
      .eq("id", connection.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!latest?.access_token_encrypted || !latest.subdomain) {
      throw new Error("Falha ao obter token Kommo após refresh concorrente.");
    }
    return {
      accessToken: await decryptSecret(latest.access_token_encrypted),
      subdomain: latest.subdomain,
      connectionId: connection.id,
    };
  }

  return {
    accessToken: tokens.access_token,
    subdomain: connection.subdomain,
    connectionId: connection.id,
  };
}

/** Kommo docs: max 7 req/s; stay under to avoid 429 and eventual IP 403. */
const KOMMO_MAX_REQUESTS_PER_SEC = 5;
const kommoRequestTimes = new Map<string, number[]>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForKommoRateLimit(tenantId: string) {
  const windowMs = 1000;
  for (;;) {
    const now = Date.now();
    const recent = (kommoRequestTimes.get(tenantId) ?? []).filter(
      (ts) => now - ts < windowMs,
    );
    if (recent.length < KOMMO_MAX_REQUESTS_PER_SEC) {
      recent.push(now);
      kommoRequestTimes.set(tenantId, recent);
      return;
    }
    const waitMs = Math.max(20, windowMs - (now - recent[0]) + 5);
    await sleep(waitMs);
  }
}

export async function kommoFetch<T>(
  tenantId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const { accessToken, subdomain } = await getValidAccessToken(tenantId);
  const url = buildKommoApiUrl(subdomain, path);
  const maxAttempts = 4;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await waitForKommoRateLimit(tenantId);

    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });

    if (res.status === 429 && attempt < maxAttempts - 1) {
      await res.text().catch(() => "");
      await sleep(1000 * 2 ** attempt);
      continue;
    }

    if (!res.ok) {
      await res.text().catch(() => "");
      throw new Error(`Kommo API ${res.status}`);
    }

    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  }

  throw new Error("Kommo API 429");
}

export async function fetchKommoLead(tenantId: string, leadId: string) {
  if (!/^\d+$/.test(leadId) || leadId === "0") {
    throw new Error("kommo_invalid_lead_id");
  }
  const data = await kommoFetch<{
    _embedded?: { leads?: unknown[] };
  }>(tenantId, `/api/v4/leads/${encodeURIComponent(leadId)}?with=contacts`);
  const embeddedLead = data._embedded?.leads?.[0];
  if (embeddedLead) return embeddedLead;
  return data as unknown;
}

export type KommoLeadStatusEvent = {
  id: string;
  type: string;
  entity_id: number;
  created_at: number;
  value_before?: Array<{ lead_status?: { id?: number; pipeline_id?: number } }>;
  value_after?: Array<{ lead_status?: { id?: number; pipeline_id?: number } }>;
};

/** Status-change timeline for one lead (newest first when Kommo returns that order). */
export async function fetchKommoLeadStatusEvents(
  tenantId: string,
  leadId: string,
): Promise<KommoLeadStatusEvent[]> {
  if (!/^\d+$/.test(leadId) || leadId === "0") {
    throw new Error("kommo_invalid_lead_id");
  }
  const params = new URLSearchParams({
    "filter[entity]": "lead",
    "filter[entity_id]": leadId,
    "filter[type]": "lead_status_changed",
    limit: "50",
  });
  const data = await kommoFetch<{
    _embedded?: { events?: KommoLeadStatusEvent[] };
  }>(tenantId, `/api/v4/events?${params.toString()}`);
  return Array.isArray(data._embedded?.events) ? data._embedded.events : [];
}

/** Map status_id → pipeline status name for qualification alias matching. */
export async function fetchKommoStatusNameById(
  tenantId: string,
): Promise<Record<string, string>> {
  const data = await kommoFetch<{
    _embedded?: {
      pipelines?: Array<{
        _embedded?: {
          statuses?: Array<{ id?: number | string; name?: string }>;
        };
      }>;
    };
  }>(tenantId, "/api/v4/leads/pipelines");

  const map: Record<string, string> = {};
  for (const pipeline of data._embedded?.pipelines ?? []) {
    for (const status of pipeline._embedded?.statuses ?? []) {
      const id = status.id != null ? String(status.id) : "";
      const name = status.name?.trim();
      if (id && name) map[id] = name;
    }
  }
  return map;
}

export async function fetchKommoAccount(tenantId: string) {
  return kommoFetch<{
    id?: number;
    name?: string;
    subdomain?: string;
  }>(tenantId, "/api/v4/account");
}
