import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  detectEventType,
  extractLeadIdsFromWebhookPayload,
} from "@/lib/kommo/normalize";

export const runtime = "nodejs";

const ALLOWED_HEADERS = new Set([
  "content-type",
  "user-agent",
  "x-request-id",
]);

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const json = await request.json();
    return json && typeof json === "object" ? (json as Record<string, unknown>) : { data: json };
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await request.formData();
    const out: Record<string, unknown> = {};
    form.forEach((value, key) => {
      out[key] = typeof value === "string" ? value : value.name;
    });
    return out;
  }

  const text = await request.text();
  if (!text) return {};
  try {
    const json = JSON.parse(text) as unknown;
    return json && typeof json === "object"
      ? (json as Record<string, unknown>)
      : { raw: text };
  } catch {
    const params = new URLSearchParams(text);
    const out: Record<string, unknown> = {};
    params.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
}

function buildIdempotencyKey(payload: Record<string, unknown>, token: string): string {
  const explicit =
    payload.idempotency_key ||
    payload.event_id ||
    payload["event[id]"] ||
    payload.message_id;
  if (explicit) return String(explicit);

  const leadIds = extractLeadIdsFromWebhookPayload(payload).sort().join(",");
  const eventType = detectEventType(payload);
  const digest = createHash("sha256")
    .update(token)
    .update(eventType)
    .update(leadIds)
    .update(JSON.stringify(payload))
    .digest("hex");
  return digest;
}

function pickSafeHeaders(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ALLOWED_HEADERS) {
    const value = request.headers.get(name);
    if (value) out[name] = value;
  }
  return out;
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" || /duplicate key|unique constraint/i.test(error.message || "");
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const started = Date.now();

  try {
    const admin = createAdminClient();
    const { data: endpoint, error } = await admin
      .from("webhook_endpoints")
      .select("id, tenant_id, is_active")
      .eq("token", token)
      .maybeSingle();

    if (error || !endpoint || !endpoint.is_active) {
      return NextResponse.json({ ok: false }, { status: 404 });
    }

    const payload = await parseBody(request);
    const idempotencyKey = buildIdempotencyKey(payload, token);
    const eventType = detectEventType(payload);
    const leadIds = extractLeadIdsFromWebhookPayload(payload);
    const headersObj = pickSafeHeaders(request);

    const { data: rawEvent, error: insertError } = await admin
      .from("raw_events")
      .upsert(
        {
          tenant_id: endpoint.tenant_id,
          webhook_endpoint_id: endpoint.id,
          provider: "kommo",
          event_type: eventType,
          idempotency_key: idempotencyKey,
          payload,
          headers: headersObj,
        },
        {
          onConflict: "tenant_id,provider,idempotency_key",
          ignoreDuplicates: true,
        },
      )
      .select("id")
      .maybeSingle();

    let rawEventId = rawEvent?.id ?? null;
    if (!rawEventId) {
      const { data: existing } = await admin
        .from("raw_events")
        .select("id")
        .eq("tenant_id", endpoint.tenant_id)
        .eq("provider", "kommo")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      rawEventId = existing?.id ?? null;
    }

    if (insertError && !rawEventId && !isUniqueViolation(insertError)) {
      console.error("raw_events insert", insertError.message);
    }

    if (rawEventId) {
      const { error: jobError } = await admin.from("jobs").insert({
        tenant_id: endpoint.tenant_id,
        raw_event_id: rawEventId,
        job_type: "process_kommo_event",
        status: "pending",
        payload: { lead_ids: leadIds, event_type: eventType },
      });

      if (jobError && !isUniqueViolation(jobError)) {
        console.error("jobs insert", jobError.message);
      }
    }

    return NextResponse.json({
      ok: true,
      ms: Date.now() - started,
    });
  } catch (error) {
    console.error("webhook kommo", error);
    return NextResponse.json({ ok: true, accepted: false }, { status: 200 });
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  return NextResponse.json({ ok: true, provider: "kommo", token: token.slice(0, 6) });
}
