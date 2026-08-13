import { NextResponse } from "next/server";
import { z } from "zod";
import { canManageTenant, getActiveTenant, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const QUALIFICATIONS = [
  "mql",
  "sal",
  "sql",
  "oportunidade",
  "negociacao",
  "venda",
  "perda",
] as const;

const mappingSchema = z.object({
  qualification: z.enum(QUALIFICATIONS),
  event_name: z.string().trim().min(1).max(120),
  include_value: z.boolean(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).default("BRL"),
  is_active: z.boolean(),
  action_source: z.string().trim().min(1).max(80).default("system_generated"),
});

const completeMappingsSchema = z
  .array(mappingSchema)
  .length(QUALIFICATIONS.length)
  .refine(
    (mappings) =>
      new Set(mappings.map((mapping) => mapping.qualification)).size ===
      QUALIFICATIONS.length,
    { message: "Informe exatamente um mapeamento para cada qualificação." },
  );

const bodySchema = z.object({
  tenant_id: z.string().uuid(),
  mappings: completeMappingsSchema,
});

/**
 * Substitui logicamente o conjunto completo de mappings do tenant. Como a API
 * exige exatamente os sete estágios, o upsert em uma única instrução atualiza
 * todos os valores sem deixar configurações antigas fora do batch.
 */
export async function PUT(request: Request) {
  try {
    const { userId } = await requireUser();
    if (!userId) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
    }

    const { tenant_id: tenantId, mappings } = parsed.data;
    const membership = await getActiveTenant(userId, tenantId);
    if (
      !membership ||
      membership.tenant.id !== tenantId ||
      !canManageTenant(membership.role)
    ) {
      return NextResponse.json(
        { error: "Permissão insuficiente." },
        { status: 403 },
      );
    }

    const admin = createAdminClient();
    const now = new Date().toISOString();
    const rows = mappings.map((m) => ({
      tenant_id: tenantId,
      qualification: m.qualification,
      event_name: m.event_name,
      include_value: m.include_value,
      currency: m.currency.toUpperCase(),
      is_active: m.is_active,
      action_source: m.action_source,
      updated_at: now,
    }));

    const { error } = await admin
      .from("meta_capi_event_mappings")
      .upsert(rows, { onConflict: "tenant_id,qualification" });

    if (error) {
      console.error("meta capi mappings upsert failed");
      return NextResponse.json(
        { error: "Falha ao salvar mapeamentos." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, count: rows.length });
  } catch (error) {
    console.error(
      "meta capi mappings save",
      error instanceof Error ? error.name : "error",
    );
    return NextResponse.json(
      { error: "Falha ao salvar mapeamentos." },
      { status: 500 },
    );
  }
}
