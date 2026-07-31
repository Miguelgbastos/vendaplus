/**
 * Helpers puros do exchange OAuth Kommo — diagnóstico sanitizado,
 * cooldown anti rate-limit e validação de resposta de tokens.
 * Nunca inclui code, secret, access_token ou refresh_token.
 */

export const OAUTH_EXCHANGE_COOLDOWN_MS = 5 * 60 * 1000;

/** Cabeçalhos úteis e não sensíveis para diagnóstico de 403/WAF. */
const SAFE_DIAGNOSTIC_HEADERS = [
  "content-type",
  "server",
  "retry-after",
  "cf-ray",
  "x-request-id",
  "x-runtime",
] as const;

export type KommoTokenResponse = {
  token_type: string;
  expires_in: number;
  access_token: string;
  refresh_token: string;
};

const REDACTED = "[REDACTED]";

/** Sequências longas típicas de code/token/secret (hex, base64url, alfanumérico). */
const LONG_SECRET_TOKEN_RE = /[A-Za-z0-9_-]{24,}/g;
const LONG_HEX_RE = /\b[a-fA-F0-9]{32,}\b/g;
const JWT_THREE_SEGMENT_RE =
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const BEARER_TOKEN_RE = /\bBearer\s+\S+/gi;
const LABELED_SECRET_RE =
  /\b(?:client_secret|access_token|refresh_token|authorization_code)\b\s*[:=]\s*["']?[^\s"',}<>]+["']?/gi;
const CODE_ASSIGN_RE = /\bcode\s*[:=]\s*["']?[A-Za-z0-9_-]{8,}["']?/gi;
const JSON_SECRET_FIELD_RE =
  /"(?:code|client_secret|access_token|refresh_token|authorization_code)"\s*:\s*"[^"]*"/gi;

/**
 * Remove padrões de segredo antes de qualquer persistência em last_error/logs.
 * Preserva apenas texto curto legível (ex.: "403 Forbidden").
 */
export function redactSensitiveOAuthFragments(input: string): string {
  return input
    .replace(BEARER_TOKEN_RE, `Bearer ${REDACTED}`)
    .replace(JWT_THREE_SEGMENT_RE, REDACTED)
    .replace(JSON_SECRET_FIELD_RE, REDACTED)
    .replace(LABELED_SECRET_RE, REDACTED)
    .replace(CODE_ASSIGN_RE, REDACTED)
    .replace(LONG_HEX_RE, REDACTED)
    .replace(LONG_SECRET_TOKEN_RE, REDACTED);
}

export function sanitizeOAuthText(input: string, max = 160): string {
  const redacted = redactSensitiveOAuthFragments(input);
  return redacted
    .replace(/[^a-zA-Z0-9 _.:/+\[\]-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Sanitização leve só para cabeçalhos estritamente allowlisted (cf-ray, x-request-id…).
 * Não aplica redação de secrets longos — esses IDs precisam permanecer úteis no suporte.
 */
export function sanitizeSafeHeaderValue(input: string, max = 80): string {
  return input
    .replace(/[^a-zA-Z0-9 _.:/+-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function sanitizeOAuthErrorDetail(body: string): string {
  let detail = "unknown_error";
  try {
    const parsed = JSON.parse(body) as {
      error?: string;
      error_description?: string;
      detail?: string;
      title?: string;
      type?: string;
    };
    // Preferir campos curtos (error/title). error_description/detail passam por redação.
    detail =
      (typeof parsed.error === "string" && parsed.error) ||
      (typeof parsed.title === "string" && parsed.title) ||
      (typeof parsed.error_description === "string" && parsed.error_description) ||
      (typeof parsed.detail === "string" && parsed.detail) ||
      detail;
  } catch {
    const plainText = body
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (plainText) detail = plainText;
  }

  return sanitizeOAuthText(detail, 160) || "unknown_error";
}

export function pickSafeDiagnosticHeaders(
  headers: Headers | Record<string, string | null | undefined> | null | undefined,
): string[] {
  if (!headers) return [];

  const get = (name: string): string | null => {
    if (headers instanceof Headers) return headers.get(name);
    const direct = headers[name] ?? headers[name.toLowerCase()];
    return direct == null ? null : String(direct);
  };

  const parts: string[] = [];
  for (const name of SAFE_DIAGNOSTIC_HEADERS) {
    const raw = get(name);
    if (!raw) continue;
    const safe = sanitizeSafeHeaderValue(raw, 80);
    if (!safe) continue;
    const key =
      name === "content-type"
        ? "ct"
        : name === "retry-after"
          ? "ra"
          : name === "cf-ray" || name === "x-request-id"
            ? "rid"
            : name === "x-runtime"
              ? "rt"
              : "server";
    // Evita duplicar rid se ambos cf-ray e x-request-id existirem
    if (key === "rid" && parts.some((p) => p.startsWith("rid="))) continue;
    parts.push(`${key}=${safe}`);
  }
  return parts;
}

/**
 * Formato estável e curto para last_error / logs:
 * kommo_oauth_exchange_403:Forbidden|ct=text/html|server=nginx|rid=...
 */
export function formatKommoOAuthExchangeError(
  status: number,
  body: string,
  headers?: Headers | Record<string, string | null | undefined> | null,
): string {
  const detail = sanitizeOAuthErrorDetail(body);
  const meta = pickSafeDiagnosticHeaders(headers);
  const base = `kommo_oauth_exchange_${status}:${detail}`;
  if (meta.length === 0) return base.slice(0, 280);
  return `${base}|${meta.join("|")}`.slice(0, 280);
}

export function isAggressiveExchangeBlockStatus(status: number): boolean {
  return status === 403 || status === 429 || status === 503;
}

export function parseExchangeStatusFromLastError(
  lastError: string | null | undefined,
): number | null {
  if (!lastError) return null;
  const match = /^kommo_oauth_exchange_(\d{3}):/.exec(lastError);
  if (!match) return null;
  return Number(match[1]);
}

/**
 * Bloqueia novo authorize se o último exchange falhou com 403/429/503
 * há menos de OAUTH_EXCHANGE_COOLDOWN_MS (evita martelar o WAF/nginx).
 */
export function shouldBlockOAuthRetry(params: {
  lastError: string | null | undefined;
  updatedAt: string | null | undefined;
  now?: number;
  cooldownMs?: number;
}): boolean {
  const status = parseExchangeStatusFromLastError(params.lastError);
  if (status == null || !isAggressiveExchangeBlockStatus(status)) return false;
  if (!params.updatedAt) return false;
  const updatedMs = Date.parse(params.updatedAt);
  if (!Number.isFinite(updatedMs)) return false;
  const now = params.now ?? Date.now();
  const cooldown = params.cooldownMs ?? OAUTH_EXCHANGE_COOLDOWN_MS;
  return now - updatedMs < cooldown;
}

export function assertKommoTokenResponse(data: unknown): KommoTokenResponse {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("kommo_oauth_exchange_invalid_token_response");
  }
  const row = data as Record<string, unknown>;
  const access = row.access_token;
  const refresh = row.refresh_token;
  const expiresIn = row.expires_in;
  const tokenType = row.token_type;

  if (typeof access !== "string" || access.length < 20) {
    throw new Error("kommo_oauth_exchange_invalid_access_token");
  }
  if (typeof refresh !== "string" || refresh.length < 20) {
    throw new Error("kommo_oauth_exchange_invalid_refresh_token");
  }
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("kommo_oauth_exchange_invalid_expires_in");
  }

  return {
    token_type: typeof tokenType === "string" && tokenType ? tokenType : "bearer",
    expires_in: expiresIn,
    access_token: access,
    refresh_token: refresh,
  };
}
