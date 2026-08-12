import { decryptSecret } from "@/lib/crypto";
import { sendCapiEvents, type SendCapiEventsResult } from "@/lib/meta-capi/client";
import {
  buildMetaCapiEvent,
  generateEventId,
  DEFAULT_QUALIFICATION_EVENT_MAP,
  type BuildEventInput,
  type MetaCapiEvent,
} from "@/lib/meta-capi/event";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QualificationStage } from "@/types/database";

type Admin = ReturnType<typeof createAdminClient>;

type CapiConnectionRow = {
  pixel_id: string | null;
  access_token_encrypted: string | null;
  test_event_code: string | null;
  is_enabled: boolean;
};

type EventMappingRow = {
  qualification: QualificationStage;
  event_name: string;
  include_value: boolean;
  currency: string;
  is_active: boolean;
  action_source: string;
};

export type DispatchQualificationInput = {
  tenantId: string;
  leadId: string;
  qualification: QualificationStage;
  eventId: string;
  occurredAt?: string | null;
  value?: number | null;
  currency?: string | null;
  eventSourceUrl?: string | null;
  user: BuildEventInput["user"];
  custom?: BuildEventInput["custom"];
};

type CapiConnectionContext = {
  enabled: boolean;
  reason: "disabled" | "not_configured" | "ok";
  pixelId: string | null;
  accessToken: string | null;
  testEventCode: string | null;
};

type TenantCapiContext = CapiConnectionContext & {
  mappings: Map<QualificationStage, EventMappingRow>;
};

/**
 * Envia (ou marca como skip) um evento CAPI para uma transição de qualificação.
 * O event_id vem do job e é preservado em todos os retries para deduplicação.
 */
export async function dispatchQualificationEvent(
  input: DispatchQualificationInput,
): Promise<
  | { skipped: true; reason: string }
  | { skipped: false; result: SendCapiEventsResult; eventId: string }
> {
  const admin = createAdminClient();
  const context = await loadTenantCapiContext(admin, input.tenantId);
  if (!context.enabled) {
    await logSkip(
      admin,
      input,
      DEFAULT_QUALIFICATION_EVENT_MAP[input.qualification] ?? "Lead",
      context.reason,
    );
    return { skipped: true, reason: context.reason };
  }

  const mapping = context.mappings.get(input.qualification);
  if (!mapping || !mapping.is_active) {
    await logSkip(
      admin,
      input,
      DEFAULT_QUALIFICATION_EVENT_MAP[input.qualification] ?? "Lead",
      "no_mapping",
    );
    return { skipped: true, reason: "no_mapping" };
  }

  const eventTimeMs = input.occurredAt
    ? Date.parse(input.occurredAt) || Date.now()
    : Date.now();

  const event = buildMetaCapiEvent({
    eventName: mapping.event_name,
    eventTimeMs,
    actionSource: mapping.action_source || "system_generated",
    eventId: input.eventId,
    eventSourceUrl: input.eventSourceUrl,
    user: input.user,
    custom: {
      ...(input.custom ?? {}),
      ...(mapping.include_value
        ? {
            value: input.value ?? undefined,
            currency: input.currency || mapping.currency || "BRL",
          }
        : {}),
      lead_status: input.qualification,
      lead_event_source: "crm",
    },
  });

  return runAndLog(admin, input, event, context, mapping);
}

/**
 * Envia um evento de teste (Lead) para validar a configuração da empresa.
 * Somente este fluxo inclui test_event_code na chamada à Meta.
 */
export async function sendTestCapiEvent(params: {
  tenantId: string;
  testEmail?: string | null;
  testEventCode?: string | null;
}): Promise<SendCapiEventsResult & { eventId: string }> {
  const admin = createAdminClient();
  const context = await loadCapiConnection(admin, params.tenantId);
  if (!context.pixelId || !context.accessToken) {
    return {
      ok: false,
      httpStatus: 0,
      fbtraceId: null,
      eventsReceived: null,
      responseBody: null,
      errorMessage: "not_configured",
      eventId: "",
    };
  }

  const eventId = generateEventId();
  const event = buildMetaCapiEvent({
    eventName: "Lead",
    eventTimeMs: Date.now(),
    actionSource: "system_generated",
    eventId,
    user: {
      email: params.testEmail ?? `vendaplus-test-${eventId}@example.com`,
      external_id: `vendaplus-test-${eventId}`,
    },
    custom: {
      lead_status: "test",
      lead_event_source: "test",
      currency: "BRL",
      value: 0,
    },
  });

  const result = await sendCapiEvents({
    pixelId: context.pixelId,
    accessToken: context.accessToken,
    events: [event],
    testEventCode: params.testEventCode ?? context.testEventCode,
  });

  return { ...result, eventId };
}

async function loadCapiConnection(
  admin: Admin,
  tenantId: string,
): Promise<CapiConnectionContext> {
  const { data: connection, error: connectionError } = await admin
    .from("meta_capi_connections")
    .select("pixel_id, access_token_encrypted, test_event_code, is_enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle<CapiConnectionRow>();

  if (connectionError) {
    throw new Error(`meta_capi_connection_lookup_failed:${connectionError.message}`);
  }

  if (!connection || !connection.pixel_id || !connection.access_token_encrypted) {
    return {
      enabled: false,
      reason: "not_configured",
      pixelId: connection?.pixel_id ?? null,
      accessToken: null,
      testEventCode: connection?.test_event_code ?? null,
    };
  }

  let accessToken: string | null = null;
  try {
    accessToken = await decryptSecret(connection.access_token_encrypted);
  } catch {
    return {
      enabled: false,
      reason: "not_configured",
      pixelId: connection.pixel_id,
      accessToken: null,
      testEventCode: connection.test_event_code,
    };
  }

  return {
    enabled: connection.is_enabled,
    reason: connection.is_enabled ? "ok" : "disabled",
    pixelId: connection.pixel_id,
    accessToken,
    testEventCode: connection.test_event_code,
  };
}

async function loadTenantCapiContext(
  admin: Admin,
  tenantId: string,
): Promise<TenantCapiContext> {
  const connection = await loadCapiConnection(admin, tenantId);
  if (!connection.enabled) {
    return { ...connection, mappings: new Map() };
  }

  const { data: mappingsData, error: mappingsError } = await admin
    .from("meta_capi_event_mappings")
    .select(
      "qualification, event_name, include_value, currency, is_active, action_source",
    )
    .eq("tenant_id", tenantId);

  if (mappingsError) {
    throw new Error(`meta_capi_mappings_lookup_failed:${mappingsError.message}`);
  }

  const mappings = new Map<QualificationStage, EventMappingRow>();
  for (const row of (mappingsData ?? []) as EventMappingRow[]) {
    mappings.set(row.qualification, row);
  }

  return { ...connection, mappings };
}

async function runAndLog(
  admin: Admin,
  input: DispatchQualificationInput,
  event: MetaCapiEvent,
  context: TenantCapiContext,
  mapping: EventMappingRow,
): Promise<{ skipped: false; result: SendCapiEventsResult; eventId: string }> {
  const eventId = event.event_id;
  const insertPayload = {
    tenant_id: input.tenantId,
    lead_id: input.leadId,
    qualification: input.qualification,
    event_name: mapping.event_name,
    event_id: eventId,
    status: "received" as const,
    request_payload: sanitizeEventForLog(event),
  };

  const { error: logInsertError } = await admin
    .from("meta_capi_events")
    .upsert(insertPayload, { onConflict: "tenant_id,event_id" });

  if (logInsertError) {
    throw new Error(`meta_capi_log_upsert_failed:${logInsertError.message}`);
  }

  const result = await sendCapiEvents({
    pixelId: context.pixelId!,
    accessToken: context.accessToken!,
    events: [event],
  });

  const nowIso = new Date().toISOString();
  const { error: logUpdateError } = await admin
    .from("meta_capi_events")
    .update({
      status: result.ok ? "sent" : "failed",
      http_status: result.httpStatus,
      fbtrace_id: result.fbtraceId,
      response_body: (result.responseBody as unknown) ?? null,
      error_message: result.errorMessage,
      sent_at: nowIso,
    })
    .eq("tenant_id", input.tenantId)
    .eq("event_id", eventId);

  if (logUpdateError) {
    throw new Error(`meta_capi_log_update_failed:${logUpdateError.message}`);
  }

  const connectionPatch = result.ok
    ? {
        status: "connected" as const,
        last_error: null,
        last_sent_at: nowIso,
        connected_at: nowIso,
      }
    : {
        status: "error" as const,
        last_error: result.errorMessage,
      };

  const { error: connectionUpdateError } = await admin
    .from("meta_capi_connections")
    .update(connectionPatch)
    .eq("tenant_id", input.tenantId);

  if (connectionUpdateError) {
    throw new Error(`meta_capi_connection_update_failed:${connectionUpdateError.message}`);
  }

  return { skipped: false, result, eventId };
}

async function logSkip(
  admin: Admin,
  input: DispatchQualificationInput,
  eventName: string,
  reason: string,
): Promise<void> {
  const { error } = await admin.from("meta_capi_events").upsert(
    {
      tenant_id: input.tenantId,
      lead_id: input.leadId,
      qualification: input.qualification,
      event_name: eventName,
      event_id: input.eventId,
      status: "failed",
      error_message: `skipped_${reason}`,
      request_payload: { skipped: true, reason },
    },
    { onConflict: "tenant_id,event_id" },
  );

  if (error) {
    throw new Error(`meta_capi_skip_log_failed:${error.message}`);
  }
}

/**
 * O user_data persistido já contém hashes. Como defesa adicional, removemos do
 * log campos que podem transportar PII em claro quando algum caller os informar.
 */
function sanitizeEventForLog(event: MetaCapiEvent): Record<string, unknown> {
  const cloned: MetaCapiEvent = JSON.parse(JSON.stringify(event));
  const ud = cloned.user_data as Record<string, unknown>;
  delete ud.client_ip_address;
  delete ud.client_user_agent;
  delete cloned.event_source_url;

  if (cloned.custom_data) {
    const customData = { ...cloned.custom_data };
    delete customData.content_name;
    cloned.custom_data = customData;
  }

  return cloned as unknown as Record<string, unknown>;
}
