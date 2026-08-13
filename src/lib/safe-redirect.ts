/**
 * Aceita apenas caminhos internos relativos (anti open-redirect).
 * Rejeita protocolo, host absoluto, //evil, backslash e control chars.
 */
export function safeInternalPath(
  next: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!next) return fallback;
  const trimmed = next.trim();
  if (!trimmed.startsWith("/")) return fallback;
  if (trimmed.startsWith("//")) return fallback;
  if (trimmed.includes("\\")) return fallback;
  if (trimmed.includes("://")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return fallback;
  // Bloqueia "/\" e esquemas embutidos após decode parcial.
  try {
    const decoded = decodeURIComponent(trimmed);
    if (decoded.startsWith("//") || decoded.includes("://") || decoded.includes("\\")) {
      return fallback;
    }
  } catch {
    return fallback;
  }
  return trimmed;
}
