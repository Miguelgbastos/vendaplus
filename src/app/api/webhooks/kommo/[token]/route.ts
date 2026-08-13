import { after, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { runKommoWorker } from "@/lib/jobs/run-kommo-worker";
import {
  detectEventType,
  extractLeadIdsFromWebhookPayload,
} from "@/lib/kommo/normalize";
import { takeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const MAX_PAYLOAD_BYTES = 256 * 1024;

const ALLOWED_HEADERS = new Set([
  "content-type",
  "user-agent",
  "x-request-id",
]);

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";
  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error("payload_too_large");
  }
  const text = new TextDecoder().decode(raw);

  if (contentType.includes("application/json")) {
    if (!text) return {};
    const json = JSON.parse(text) as unknown;
    return json && typeof json === "object" ? (json as Record<string, unknown>) : { data: json };
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await new Response(raw, {
      headers: { "content-type": contentType },
    }).formData();
    const out: Record<string, unknown> = {};
    form.forEach((value, key) => {
      out[key] = typeof value === "string" ? value : value.name;
    });
    return out;
  }

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

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const started = Date.now();

  const limited = takeRateLimit(`webhook:kommo:${token.slice(0, 16)}`, 120, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

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

    let payload: Record<string, unknown>;
    try {
      payload = await parseBody(request);
    } catch (parseError) {
      if (parseError instanceof Error && parseError.message === "payload_too_large") {
        return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
      }
      return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
    }

    const idempotencyKey = buildIdempotencyKey(payload, token);
    const eventType = detectEventType(payload);
    const leadIds = extractLeadIdsFromWebhookPayload(payload);
    const headersObj = pickSafeHeaders(request);

    const { data: enqueued, error: enqueueError } = await admin.rpc(
      "enqueue_kommo_webhook_event",
      {
        p_tenant_id: endpoint.tenant_id,
        p_webhook_endpoint_id: endpoint.id,
        p_event_type: eventType,
        p_idempotency_key: idempotencyKey,
        p_payload: payload,
        p_headers: headersObj,
        p_lead_ids: leadIds,
      },
    );

    if (enqueueError) {
      console.error("enqueue_kommo_webhook_event", enqueueError.message);
      return NextResponse.json({ ok: false, error: "enqueue_failed" }, { status: 500 });
    }

    const row = Array.isArray(enqueued) ? enqueued[0] : enqueued;
    const rawEventId = (row as { raw_event_id?: string } | null)?.raw_event_id ?? null;
    const created = Boolean((row as { created?: boolean } | null)?.created);

    if (rawEventId && leadIds.length > 0 && created) {
      after(async () => {
        try {
          await runKommoWorker({
            limit: 10,
            workerId: `webhook-${rawEventId}`,
            tenantId: endpoint.tenant_id,
          });
        } catch (workerError) {
          console.error("kommo webhook worker", workerError);
        }
      });
    }

    return NextResponse.json({
      ok: true,
      ms: Date.now() - started,
    });
  } catch (error) {
    console.error("webhook kommo", error);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

export async function GET() {
  return new NextResponse(null, { status: 204 });
}
