import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { hashInviteToken } from "@/lib/invites";
import { takeRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  token: z.string().min(16).max(256),
});

export async function POST(request: Request) {
  try {
    const { userId, supabase } = await requireUser();
    if (!userId) return NextResponse.json({ error: "Entre na conta para aceitar o convite." }, { status: 401 });

    const limited = takeRateLimit(`invite-accept:${userId}`, 20, 60_000);
    if (!limited.ok) {
      return NextResponse.json({ error: "Muitas tentativas." }, { status: 429 });
    }

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Token inválido." }, { status: 400 });

    const { data, error } = await supabase.rpc("accept_tenant_invite", {
      p_token_hash: hashInviteToken(parsed.data.token),
    });
    if (error) {
      const msg = error.message || "";
      if (msg.includes("invite_email_mismatch")) {
        return NextResponse.json(
          { error: "Este convite foi enviado para outro e-mail." },
          { status: 403 },
        );
      }
      if (msg.includes("invite_expired")) {
        return NextResponse.json({ error: "Este convite expirou." }, { status: 410 });
      }
      if (msg.includes("invite_cancelled")) {
        return NextResponse.json({ error: "Este convite foi cancelado." }, { status: 410 });
      }
      if (msg.includes("invite_already_accepted")) {
        return NextResponse.json({ error: "Este convite já foi aceito." }, { status: 409 });
      }
      if (msg.includes("invite_not_found")) {
        return NextResponse.json({ error: "Convite não encontrado." }, { status: 404 });
      }
      return NextResponse.json({ error: "Não foi possível aceitar o convite." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, membership_id: data });
  } catch (error) {
    console.error("invite accept", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "Falha ao aceitar convite." }, { status: 500 });
  }
}
