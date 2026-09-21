import { createAdminClient } from "@/lib/supabase/admin";
import { hashCanonicalJson } from "@/lib/gwe/v1/canonicalization";
import { readGweBody } from "@/lib/gwe/v1/http";
import {
  GweSignatureError,
  parseGweTimestamp,
  verifyEncryptedGweSignature,
} from "@/lib/gwe/v1/signature";
import { validateGwePayload } from "@/lib/gwe/v1/validation";
import { takeRateLimit } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const ENDPOINT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ endpointId: string }> };

type SigningKey = {
  encrypted_secret: string;
  status: string;
  valid_from: string;
  valid_until: string | null;
  revoked_at: string | null;
};

function errorResponse(error: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ ok: false, error }, { status, headers });
}

function isKeyUsable(key: SigningKey, now: number): boolean {
  if (key.status !== "active" && key.status !== "grace_period") return false;
  if (key.revoked_at) return false;
  const validFrom = Date.parse(key.valid_from);
  const validUntil = key.valid_until ? Date.parse(key.valid_until) : Number.POSITIVE_INFINITY;
  return validFrom <= now && now <= validUntil;
}

export async function POST(request: Request, { params }: RouteContext) {
  const { endpointId } = await params;
  if (!ENDPOINT_ID_PATTERN.test(endpointId)) {
    return errorResponse("endpoint_not_found", 404);
  }

  const globalLimited = takeRateLimit("webhook:gwe:global", 2_000, 60_000);
  if (!globalLimited.ok) {
    return errorResponse("rate_limited", 429, {
      "Retry-After": String(globalLimited.retryAfterSec),
    });
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim();
  if (contentType !== "application/json") {
    return errorResponse("unsupported_media_type", 415);
  }

  let rawBody: string;
  try {
    rawBody = await readGweBody(request);
  } catch (error) {
    if (error instanceof Error && error.message === "payload_too_large") {
      return errorResponse("payload_too_large", 413);
    }
    return errorResponse("invalid_payload", 400);
  }

  const admin = createAdminClient();
  const { data: endpoint, error: endpointError } = await admin
    .from("webhook_endpoints")
    .select("id, endpoint_public_id, is_active, connection_id, crm_connections!inner(id, is_active)")
    .eq("endpoint_public_id", endpointId)
    .eq("is_active", true)
    .eq("crm_connections.is_active", true)
    .maybeSingle();

  if (endpointError) {
    console.error("gwe webhook endpoint lookup", endpointError.message);
    return errorResponse("internal_error", 500);
  }
  if (!endpoint) return errorResponse("endpoint_not_found", 404);

  const limited = takeRateLimit(`webhook:gwe:${endpoint.id}`, 120, 60_000);
  if (!limited.ok) {
    return errorResponse("rate_limited", 429, {
      "Retry-After": String(limited.retryAfterSec),
    });
  }

  const timestampHeader = request.headers.get("x-gwe-timestamp");
  let timestamp: number;
  try {
    timestamp = parseGweTimestamp(timestampHeader);
  } catch (error) {
    if (error instanceof GweSignatureError && error.code === "expired") {
      return errorResponse("invalid_signature", 401);
    }
    return errorResponse("invalid_signature", 401);
  }

  const keyId = request.headers.get("x-gwe-key-id");
  if (!keyId || keyId.length > 128) return errorResponse("invalid_signature", 401);

  const { data: key, error: keyError } = await admin
    .from("webhook_signing_keys")
    .select("encrypted_secret, status, valid_from, valid_until, revoked_at")
    .eq("webhook_endpoint_id", endpoint.id)
    .eq("key_id", keyId)
    .maybeSingle();

  if (keyError) {
    console.error("gwe webhook signing key lookup", keyError.message);
    return errorResponse("internal_error", 500);
  }
  if (!key || !isKeyUsable(key as SigningKey, Date.now())) {
    return errorResponse("invalid_signature", 401);
  }

  try {
    await verifyEncryptedGweSignature(
      rawBody,
      timestamp,
      request.headers.get("x-gwe-signature"),
      key.encrypted_secret,
    );
  } catch (error) {
    if (error instanceof GweSignatureError && error.code === "expired") {
      return errorResponse("invalid_signature", 401);
    }
    if (!(error instanceof GweSignatureError)) {
      console.error("gwe webhook signing key decryption", error);
      return errorResponse("internal_error", 500);
    }
    console.warn("gwe webhook signature rejected", {
      endpointId,
      keyId,
      reason: error.code,
    });
    return errorResponse("invalid_signature", 401);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return errorResponse("invalid_json", 400);
  }

  let payload;
  try {
    payload = validateGwePayload(parsed);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_gwe_payload",
        issues: error instanceof Error && "issues" in error ? error.issues : undefined,
      },
      { status: 422 },
    );
  }

  const headers = {
    "content-type": contentType,
    "user-agent": request.headers.get("user-agent"),
    "x-gwe-key-id": keyId,
    "x-gwe-timestamp": timestampHeader,
  };
  const { data: result, error: ingestError } = await admin.rpc(
    "ingest_crm_webhook_event",
    {
      p_endpoint_public_id: endpoint.endpoint_public_id,
      p_external_event_id: payload.event.id,
      p_event_type: payload.event.type,
      p_payload: payload,
      p_payload_hash: hashCanonicalJson(payload),
      p_safe_headers: headers,
      p_occurred_at: payload.event.occurred_at,
    },
  );

  if (ingestError) {
    console.error("gwe webhook ingestion", ingestError.message);
    if (ingestError.message.includes("event_id_collision")) {
      return errorResponse("event_id_collision", 409);
    }
    if (
      ingestError.message.includes("webhook_endpoint_not_found") ||
      ingestError.message.includes("crm_connection_inactive")
    ) {
      return errorResponse("endpoint_not_found", 404);
    }
    return errorResponse("internal_error", 500);
  }

  const row = Array.isArray(result) ? result[0] : result;
  if (row?.status === "event_id_collision") {
    return errorResponse("event_id_collision", 409);
  }
  if (row?.status === "already_received") {
    return NextResponse.json({ ok: true, status: "already_received" }, { status: 200 });
  }
  if (row?.status === "accepted") {
    return NextResponse.json({ ok: true, status: "accepted" }, { status: 202 });
  }
  console.error("gwe webhook unexpected ingestion status", row?.status);
  return errorResponse("internal_error", 500);
}
