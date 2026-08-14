export const MAX_KOMMO_WEBHOOK_PAYLOAD_BYTES = 256 * 1024;

function formDataToRecord(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  form.forEach((value, key) => {
    out[key] = typeof value === "string" ? value : value.name;
  });
  return out;
}

function searchParamsToRecord(params: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export async function parseKommoWebhookBody(
  request: Request,
  maxPayloadBytes = MAX_KOMMO_WEBHOOK_PAYLOAD_BYTES,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";
  const raw = await request.arrayBuffer();
  if (raw.byteLength > maxPayloadBytes) {
    throw new Error("payload_too_large");
  }

  const text = new TextDecoder().decode(raw);

  if (contentType.includes("application/json")) {
    if (!text) return {};
    const json = JSON.parse(text) as unknown;
    return json && typeof json === "object"
      ? (json as Record<string, unknown>)
      : { data: json };
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return searchParamsToRecord(new URLSearchParams(text));
  }

  if (contentType.includes("multipart/form-data")) {
    const form = await new Response(raw, {
      headers: { "content-type": contentType },
    }).formData();
    return formDataToRecord(form);
  }

  if (!text) return {};
  try {
    const json = JSON.parse(text) as unknown;
    return json && typeof json === "object"
      ? (json as Record<string, unknown>)
      : { raw: text };
  } catch {
    return searchParamsToRecord(new URLSearchParams(text));
  }
}
