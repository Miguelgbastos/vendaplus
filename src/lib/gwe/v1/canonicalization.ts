import { sha256Hex } from "../../crypto.ts";

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JSON não suporta número não finito.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error("Valor não suportado para canonicalização JSON.");
}

/** Canonicalização determinística compatível com o perfil JSON do GWE v1. */
export function canonicalizeJson(value: unknown): string {
  return canonicalize(value);
}

export function hashCanonicalJson(value: unknown): string {
  return sha256Hex(canonicalizeJson(value));
}
