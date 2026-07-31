/**
 * Aceita "minhaempresa" ou "minhaempresa.kommo.com" (com/sem protocolo).
 * Retorna apenas o subdomínio, ou null se vazio, ou erro se inválido.
 */
export function normalizeKommoSubdomain(
  input: string | null | undefined,
): { ok: true; subdomain: string | null } | { ok: false } {
  if (input == null || !input.trim()) {
    return { ok: true, subdomain: null };
  }

  let raw = input.trim().toLowerCase();
  raw = raw.replace(/^https?:\/\//, "");
  raw = raw.split("/")[0] ?? raw;

  if (raw.endsWith(".kommo.com")) {
    raw = raw.slice(0, -".kommo.com".length);
  }

  // Após remover .kommo.com, não pode restar outro domínio
  if (raw.includes(".") || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(raw)) {
    return { ok: false };
  }

  if (raw.length < 2 || raw.length > 63) {
    return { ok: false };
  }

  return { ok: true, subdomain: raw };
}
