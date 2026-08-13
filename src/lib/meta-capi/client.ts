import type { MetaCapiEvent } from "./event.ts";

const DEFAULT_META_GRAPH_API_VERSION = "v20.0";
const META_CAPI_TIMEOUT_MS = 10_000;

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

function resolveGraphApiVersion(): string {
  const configured = process.env.META_GRAPH_API_VERSION?.trim();
  return configured && /^v\d+\.\d+$/.test(configured)
    ? configured
    : DEFAULT_META_GRAPH_API_VERSION;
}

/**
 * Envia um lote de eventos CAPI para o Pixel da empresa e devolve um resumo.
 * A versão da Graph API pode ser atualizada por META_GRAPH_API_VERSION sem
 * alteração de código. Chamadas externas expiram em 10 segundos.
 */
export async function sendCapiEvents(
  input: SendCapiEventsInput,
  fetchImpl: typeof fetch = fetch,
): Promise<SendCapiEventsResult> {
  const version = resolveGraphApiVersion();
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(
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
      signal: AbortSignal.timeout(META_CAPI_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      httpStatus: 0,
      fbtraceId: null,
      eventsReceived: null,
      responseBody: null,
      errorMessage: error instanceof Error ? error.message : "network_error",
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
      typeof record.events_received === "number" ? record.events_received : null,
    responseBody: json,
    errorMessage:
      errorObj?.message ??
      (!response.ok ? `meta_capi_http_${response.status}` : null),
  };
}
