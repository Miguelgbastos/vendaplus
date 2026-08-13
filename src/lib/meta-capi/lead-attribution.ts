type MetaAttribution = {
  leadId: string | null;
  fbc: string | null;
  fbp: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function firstValue(
  fields: Record<string, unknown>,
  exactKeys: string[],
  keyPattern?: RegExp,
  validate?: (value: string) => boolean,
): string | null {
  const accept = (value: string | null): value is string =>
    value !== null && (!validate || validate(value));

  for (const key of exactKeys) {
    const value = text(fields[key]);
    if (accept(value)) return value;
  }

  if (keyPattern) {
    for (const [key, raw] of Object.entries(fields)) {
      if (!keyPattern.test(key)) continue;
      const value = text(raw);
      if (accept(value)) return value;
    }
  }

  return null;
}

/**
 * Extrai identificadores de atribuição preservados nos campos customizados do
 * Kommo. O lead_id da Meta só é aceito no formato documentado (15–17 dígitos),
 * evitando confundi-lo com o id interno do Kommo ou do Venda+.
 */
export function extractMetaAttribution(value: unknown): MetaAttribution {
  const fields = asRecord(value);
  const isMetaLeadId = (candidate: string) => /^\d{15,17}$/.test(candidate);

  return {
    leadId: firstValue(
      fields,
      ["meta_lead_id", "facebook_lead_id", "fb_lead_id", "lead_id"],
      /(?:meta|facebook|fb).*lead.*id|lead.*id.*(?:meta|facebook|fb)/i,
      isMetaLeadId,
    ),
    fbc: firstValue(fields, ["fbc", "_fbc"], /(?:^|_)fbc$/i),
    fbp: firstValue(fields, ["fbp", "_fbp"], /(?:^|_)fbp$/i),
  };
}
