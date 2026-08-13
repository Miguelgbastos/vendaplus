import { createHash } from "node:crypto";

/**
 * Conversions API exige que dados pessoais (email, phone, nome, city, ...)
 * sejam hasheados em SHA-256 hex minúsculo, após normalização (trim + lowercase
 * para email e strings; dígitos com DDI para phone).
 *
 * Referência: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
 */

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function normalizeString(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

export function hashEmail(email: string | null | undefined): string | null {
  const normalized = normalizeString(email);
  if (!normalized) return null;
  return sha256Hex(normalized);
}

/**
 * Phone: apenas dígitos, sem `+` e sem separadores. Se não houver código de
 * país, prefixamos 55 (Brasil), já que Venda+ é primariamente PT-BR.
 */
export function hashPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D+/g, "");
  if (!digits) return null;
  const withCc = digits.length <= 11 ? `55${digits}` : digits;
  return sha256Hex(withCc);
}

/** Nome/sobrenome/city/state: lowercase, sem espaços em branco extras. */
export function hashName(value: string | null | undefined): string | null {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  return sha256Hex(normalized.replace(/\s+/g, " "));
}

/** External ID: preservamos o valor bruto (ex.: contact_id do Kommo) em SHA-256. */
export function hashExternalId(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  return sha256Hex(s.toLowerCase());
}

export function splitFullName(fullName: string | null | undefined): {
  first: string | null;
  last: string | null;
} {
  if (!fullName) return { first: null, last: null };
  const parts = String(fullName).trim().split(/\s+/);
  if (!parts.length) return { first: null, last: null };
  const first = parts.shift() ?? null;
  const last = parts.length ? parts.join(" ") : null;
  return { first, last };
}
