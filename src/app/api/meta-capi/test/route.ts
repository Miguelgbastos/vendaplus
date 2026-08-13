import { NextResponse } from "next/server";
import { z } from "zod";
import { canManageTenant, getActiveTenant, requireUser } from "@/lib/auth";
import { sendTestCapiEvent } from "@/lib/meta-capi/send";

export const runtime = "nodejs";

const bodySchema = z.object({
  tenant_id: z.string().uuid(),
  test_event_code: z.string().trim().max(200).optional(),
  test_email: z.string().trim().max(200).optional(),
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
      return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
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

    const result = await sendTestCapiEvent({
      tenantId: parsed.data.tenant_id,
      testEmail: parsed.data.test_email || null,
      testEventCode: parsed.data.test_event_code || null,
    });

    if (result.errorMessage === "not_configured") {
      return NextResponse.json(
        { error: "Configure Pixel ID e Access Token antes de testar." },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: result.ok,
      http_status: result.httpStatus,
      events_received: result.eventsReceived,
      fbtrace_id: result.fbtraceId,
      event_id: result.eventId,
      error_message: result.errorMessage,
    });
  } catch (error) {
    console.error(
      "meta capi test",
      error instanceof Error ? error.name : "error",
    );
    return NextResponse.json(
      { error: "Falha ao enviar evento de teste." },
      { status: 500 },
    );
  }
}
