import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getSetupSecret } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/utils";

const schema = z.object({
  company_name: z.string().trim().min(2).max(120),
  setup_secret: z.string().min(1).max(1024),
});

function secretsMatch(input: string, expected: string): boolean {
  const left = createHash("sha256").update(input).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireUser();
    if (!userId) return NextResponse.json({ error: "Entre na sua conta antes de instalar." }, { status: 401 });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dados de instalação inválidos." }, { status: 400 });
    if (!secretsMatch(parsed.data.setup_secret, getSetupSecret())) {
      return NextResponse.json({ error: "Segredo de instalação inválido." }, { status: 403 });
    }

    const slug = slugify(parsed.data.company_name) || `empresa-${userId.slice(0, 8)}`;
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("complete_app_installation", {
      p_user_id: userId,
      p_company_name: parsed.data.company_name,
      p_company_slug: slug,
    });
    if (error || !data) {
      const alreadyDone = /installation_already_complete/i.test(error?.message || "");
      return NextResponse.json(
        { error: alreadyDone ? "A instalação já foi concluída." : "Não foi possível concluir a instalação." },
        { status: alreadyDone ? 409 : 500 },
      );
    }
    return NextResponse.json({ ok: true, company_id: data });
  } catch (error) {
    console.error("setup complete", error instanceof Error ? error.name : "error");
    return NextResponse.json({ error: "Configuração do deploy incompleta." }, { status: 500 });
  }
}
