import { NextResponse } from "next/server";
import { z } from "zod";
import { canManageTenant, getActiveTenant, requireUser } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { DEFAULT_QUALIFICATION_EVENT_MAP } from "@/lib/meta-capi/event";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QualificationStage } from "@/types/database";

export const runtime = "nodejs";

const QUALIFICATIONS: QualificationStage[] = [
  "mql",
  "sal",
  "sql",
  "oportunidade",
  "negociacao",
  "venda",
  "perda",
];

const bodySchema = z.object({
  tenant_id: z.string().uuid(),
  pixel_id: z.string().trim().min(3).max(200),
  access_token: z.string().max(5000).optional(),
  test_event_code: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : null)),
  is_enabled: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser();
    if (!userId) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            "Dados inválidos. Confira Pixel ID e Access Token do Meta Ads.",
        },
        { status: 400 },
      );
    }

    const { tenant_id: tenantId } = parsed.data;
    const membership = await getActiveTenant(userId, tenantId);
    if (!membership || membership.tenant.id !== tenantId) {
      return NextResponse.json(
        { error: "Sem acesso à empresa." },
        { status: 403 },
      );
    }
    if (!canManageTenant(membership.role)) {
      return NextResponse.json(
        { error: "Permissão insuficiente." },
        { status: 403 },
      );
    }

    const pixelId = parsed.data.pixel_id.trim();
    if (!/^\d{8,32}$/.test(pixelId)) {
      return NextResponse.json(
        {
          error: "Pixel ID inválido. Use apenas dígitos (8 a 32 caracteres).",
        },
        { status: 400 },
      );
    }

    const accessTokenInput = parsed.data.access_token?.trim() || "";
    const admin = createAdminClient();
    const { data: existing, error: existingError } = await admin
      .from("meta_capi_connections")
      .select("id, tenant_id, access_token_encrypted, status")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (existingError) {
      throw new Error(`meta_capi_connection_lookup_failed:${existingError.message}`);
    }

    let accessTokenEncrypted: string | null = null;
    if (accessTokenInput) {
      accessTokenEncrypted = await encryptSecret(accessTokenInput);
    } else if (existing?.access_token_encrypted) {
      accessTokenEncrypted = existing.access_token_encrypted;
    } else {
      return NextResponse.json(
        {
          error:
            "Informe o Access Token do sistema (System User) na primeira configuração.",
        },
        { status: 400 },
      );
    }

    const isEnabled =
      parsed.data.is_enabled ??
      (existing?.status === "connected" || existing?.status === "configured");

    const now = new Date().toISOString();
    const payload = {
      tenant_id: tenantId,
      pixel_id: pixelId,
      access_token_encrypted: accessTokenEncrypted,
      test_event_code: parsed.data.test_event_code,
      is_enabled: isEnabled,
      status:
        existing?.status === "connected" ? "connected" : ("configured" as const),
      last_error: null,
      updated_at: now,
    };

    const { error: upsertError } = await admin
      .from("meta_capi_connections")
      .upsert(payload, { onConflict: "tenant_id" });

    if (upsertError) {
      throw new Error(`meta_capi_credentials_upsert_failed:${upsertError.message}`);
    }

    const defaultMappings = QUALIFICATIONS.map((qualification) => ({
      tenant_id: tenantId,
      qualification,
      event_name: DEFAULT_QUALIFICATION_EVENT_MAP[qualification] ?? "Lead",
      include_value: qualification === "venda" || qualification === "negociacao",
      currency: "BRL",
      is_active: qualification !== "perda",
      action_source: "system_generated",
      updated_at: now,
    }));

    const { error: mappingsError } = await admin
      .from("meta_capi_event_mappings")
      .upsert(defaultMappings, {
        onConflict: "tenant_id,qualification",
        ignoreDuplicates: true,
      });

    if (mappingsError) {
      throw new Error(`meta_capi_default_mappings_failed:${mappingsError.message}`);
    }

    return NextResponse.json({
      ok: true,
      pixel_id: pixelId,
      access_token_configured: true,
      test_event_code: parsed.data.test_event_code,
      is_enabled: isEnabled,
    });
  } catch (error) {
    console.error(
      "meta capi credentials save",
      error instanceof Error ? error.name : "error",
    );
    return NextResponse.json(
      { error: "Falha ao salvar configuração." },
      { status: 500 },
    );
  }
}

const disableSchema = z.object({
  tenant_id: z.string().uuid(),
});

export async function DELETE(request: Request) {
  try {
    const { userId } = await requireUser();
    if (!userId) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }
    const url = new URL(request.url);
    const parsed = disableSchema.safeParse({
      tenant_id: url.searchParams.get("tenant_id") || "",
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
    }
    const membership = await getActiveTenant(userId, parsed.data.tenant_id);
    if (
      !membership ||
      membership.tenant.id !== parsed.data.tenant_id ||
      !canManageTenant(membership.role)
    ) {
      return NextResponse.json(
        { error: "Permissão insuficiente." },
        { status: 403 },
      );
    }

    const admin = createAdminClient();
    const { error: disableError } = await admin
      .from("meta_capi_connections")
      .update({
        access_token_encrypted: null,
        is_enabled: false,
        status: "disconnected",
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", parsed.data.tenant_id);

    if (disableError) {
      throw new Error(`meta_capi_disconnect_failed:${disableError.message}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "meta capi credentials delete",
      error instanceof Error ? error.name : "error",
    );
    return NextResponse.json(
      { error: "Falha ao desconectar Meta CAPI." },
      { status: 500 },
    );
  }
}
