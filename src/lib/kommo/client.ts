import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getKommoRedirectUri } from "@/lib/env";

export type KommoTokenResponse = {
  token_type: string;
  expires_in: number;
  access_token: string;
  refresh_token: string;
};

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

function kommoOAuthError(status: number, body: string) {
  let detail = "unknown_error";
  try {
    const parsed = JSON.parse(body) as {
      error?: string;
      error_description?: string;
      detail?: string;
      title?: string;
    };
    detail =
      parsed.error_description ||
      parsed.error ||
      parsed.detail ||
      parsed.title ||
      detail;
  } catch {
    // Respostas de proxy/WAF costumam ser HTML ou texto. Removemos marcação e
    // aceitamos apenas uma mensagem curta e sanitizada, nunca o corpo bruto.
    const plainText = body
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (plainText) detail = plainText;
  }

  const safeDetail = detail
    .replace(/[^a-zA-Z0-9 _.-]/g, "")
    .trim()
    .slice(0, 160);
  return new Error(`kommo_oauth_exchange_${status}:${safeDetail}`);
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
        "User-Agent": "VendaPlus-Kommo-OAuth/1.0",
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
    throw kommoOAuthError(res.status, body);
  }
  return (await res.json()) as KommoTokenResponse;
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
        "User-Agent": "VendaPlus-Kommo-OAuth/1.0",
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
    await res.text().catch(() => "");
    throw new Error(`Falha no refresh OAuth Kommo: ${res.status}`);
  }
  return (await res.json()) as KommoTokenResponse;
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
    throw new Error("Conexão Kommo não encontrada para o tenant.");
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
  if (!connection.access_token_encrypted || !connection.refresh_token_encrypted) {
    throw new Error("Tokens Kommo ausentes.");
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

  const { error: updateError } = await admin
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

  if (updateError) {
    throw new Error("Falha ao atualizar tokens Kommo.");
  }

  return {
    accessToken: tokens.access_token,
    subdomain: connection.subdomain,
    connectionId: connection.id,
  };
}

export async function kommoFetch<T>(
  tenantId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const { accessToken, subdomain } = await getValidAccessToken(tenantId);
  const url = path.startsWith("http")
    ? path
    : `https://${subdomain}.kommo.com${path.startsWith("/") ? path : `/${path}`}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    await res.text().catch(() => "");
    throw new Error(`Kommo API ${res.status}`);
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

export async function fetchKommoLead(tenantId: string, leadId: string) {
  const data = await kommoFetch<{
    _embedded?: { leads?: unknown[] };
  }>(tenantId, `/api/v4/leads/${leadId}?with=contacts`);
  const embeddedLead = data._embedded?.leads?.[0];
  if (embeddedLead) return embeddedLead;
  return data as unknown;
}

export async function fetchKommoAccount(tenantId: string) {
  return kommoFetch<{
    id?: number;
    name?: string;
    subdomain?: string;
  }>(tenantId, "/api/v4/account");
}
