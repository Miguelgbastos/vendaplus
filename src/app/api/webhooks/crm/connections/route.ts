import { NextResponse } from "next/server";
import { z } from "zod";
import { canManageTenant, getActiveTenant, requireUser } from "@/lib/auth";
import { encryptSecret, randomWebhookToken } from "@/lib/crypto";
import { getAppUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const providerSchema = z.enum(["gwe", "hubspot", "pipedrive", "rd_station", "generic"]);
const createSchema = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  provider: providerSchema,
});
const updateSchema = z.object({
  tenant_id: z.string().uuid(),
  connection_id: z.string().uuid(),
  is_active: z.boolean(),
});
const rotateSchema = z.object({
  tenant_id: z.string().uuid(),
  connection_id: z.string().uuid(),
  action: z.literal("rotate_key"),
});

async function authorize(tenantId: string) {
  const { userId } = await requireUser();
  if (!userId) return { error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }) };
  const membership = await getActiveTenant(userId, tenantId);
  if (!membership || membership.tenant.id !== tenantId || !canManageTenant(membership.role)) {
    return { error: NextResponse.json({ error: "Permissão insuficiente." }, { status: 403 }) };
  }
  return { membership, userId };
}

export async function POST(request: Request) {
  try {
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Informe nome e provider válidos." }, { status: 400 });
    const access = await authorize(parsed.data.tenant_id);
    if ("error" in access) return access.error;

    const endpointToken = randomWebhookToken();
    const secret = `gwe_secret_${randomWebhookToken()}`;
    const keyId = `key_${randomWebhookToken().slice(0, 16)}`;
    const endpointPublicId = crypto.randomUUID();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_gwe_connection", {
      p_tenant_id: parsed.data.tenant_id,
      p_provider: parsed.data.provider,
      p_name: parsed.data.name,
      p_schema_version: 1,
      p_endpoint_token: endpointToken,
      p_endpoint_public_id: endpointPublicId,
      p_key_id: keyId,
      p_encrypted_secret: await encryptSecret(secret),
      p_created_by: access.userId,
    });
    if (error || !data?.[0]) throw new Error(`gwe_connection_create_failed:${error?.message ?? "unknown"}`);

    return NextResponse.json({
      endpoint_url: `${getAppUrl()}/api/v1/webhooks/crm/${data[0].endpoint_public_id}`,
      key_id: keyId,
      secret,
    }, { status: 201 });
  } catch (error) {
    console.error("crm webhook connection create", error instanceof Error ? error.name : "error");
    return NextResponse.json({ error: "Não foi possível criar o webhook." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    const access = await authorize(parsed.data.tenant_id);
    if ("error" in access) return access.error;
    const admin = createAdminClient();
    const { error: connectionError } = await admin
      .from("crm_connections")
      .update({ is_active: parsed.data.is_active })
      .eq("id", parsed.data.connection_id)
      .eq("tenant_id", parsed.data.tenant_id);
    if (connectionError) throw new Error(`crm_connection_update_failed:${connectionError.message}`);
    const { error: endpointError } = await admin
      .from("webhook_endpoints")
      .update({ is_active: parsed.data.is_active })
      .eq("connection_id", parsed.data.connection_id)
      .eq("tenant_id", parsed.data.tenant_id);
    if (endpointError) throw new Error(`webhook_endpoint_update_failed:${endpointError.message}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("crm webhook connection update", error instanceof Error ? error.name : "error");
    return NextResponse.json({ error: "Não foi possível atualizar o webhook." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
    try {
      const parsed = rotateSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
      const access = await authorize(parsed.data.tenant_id);
      if ("error" in access) return access.error;
      const secret = `gwe_secret_${randomWebhookToken()}`;
      const keyId = `key_${randomWebhookToken().slice(0, 16)}`;
      const supabase = await createClient();
      const { data, error } = await supabase.rpc("rotate_gwe_webhook_signing_key", {
        p_tenant_id: parsed.data.tenant_id,
        p_connection_id: parsed.data.connection_id,
        p_key_id: keyId,
        p_encrypted_secret: await encryptSecret(secret),
        p_created_by: access.userId,
      });
      if (error || !data?.[0]) throw new Error(`gwe_key_rotation_failed:${error?.message ?? "unknown"}`);
      return NextResponse.json({
        endpoint_url: `${getAppUrl()}/api/v1/webhooks/crm/${data[0].endpoint_public_id}`,
        key_id: keyId,
        secret,
        grace_until: data[0].grace_until,
      });
    } catch (error) {
      console.error("crm webhook signing key rotation", error instanceof Error ? error.name : "error");
      return NextResponse.json({ error: "Não foi possível rotacionar a chave." }, { status: 500 });
  }
}
