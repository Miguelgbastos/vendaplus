import type { MetaCapiEvent } from "@/lib/meta-capi/event";

/** Meta Graph API — versão que a Conversions API aceita atualmente. */
const META_GRAPH_API_VERSION = "v20.0";

export type SendCapiEventsInput = {
  pixelId: string;
  accessToken: string;
  events: MetaCapiEvent[];
  testEventCode?: string | null;
};

export type SendCapiEventsResult = {
  ok: boolean;
  httpStatus: number;
  fbtraceId: string | null;
  eventsReceived: number | null;
  responseBody: unknown;
  errorMessage: string | null;
};

/**
 * Envia um lote de eventos CAPI para o Pixel do tenant e devolve um resumo.
 * Nunca lança em rota de produção: consumidores usam `ok` + `errorMessage`.
 */
export async function sendCapiEvents(
  input: SendCapiEventsInput,
  fetchImpl: typeof fetch = fetch,
): Promise<SendCapiEventsResult> {
  const url = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(
    input.pixelId,
  )}/events`;

  const body: Record<string, unknown> = {
    data: input.events,
    access_token: input.accessToken,
    partner_agent: "vendaplus-crm-1.0",
  };
  if (input.testEventCode) body.test_event_code = input.testEventCode;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    return {
      ok: false,
      httpStatus: 0,
      fbtraceId: null,
      eventsReceived: null,
      responseBody: null,
      errorMessage:
        error instanceof Error ? error.message : "network_error",
    };
  }

  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  const record =
    json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const errorObj = record.error as
    | { message?: string; fbtrace_id?: string }
    | undefined;

  return {
    ok: response.ok && !errorObj,
    httpStatus: response.status,
    fbtraceId:
      typeof record.fbtrace_id === "string"
        ? record.fbtrace_id
        : errorObj?.fbtrace_id ?? null,
    eventsReceived:
      typeof record.events_received === "number"
        ? record.events_received
        : null,
    responseBody: json,
    errorMessage:
      errorObj?.message ??
      (!response.ok ? `meta_capi_http_${response.status}` : null),
  };
}
