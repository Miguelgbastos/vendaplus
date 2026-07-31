"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/utils";

function mapCreateTenantError(message: string | undefined): string {
  const raw = message || "";
  if (/tenant_slug_unavailable/i.test(raw)) {
    return "Este identificador já está em uso. Escolha outro nome.";
  }
  if (/authentication_required/i.test(raw)) {
    return "Sessão inválida. Entre novamente.";
  }
  if (/invalid_tenant_name/i.test(raw)) {
    return "Informe um nome com pelo menos 2 caracteres.";
  }
  if (/invalid_tenant_slug/i.test(raw)) {
    return "Nome inválido para gerar o identificador. Tente outro.";
  }
  return raw || "Não foi possível criar a organização.";
}

export function CreateTenantForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data: auth } = await supabase.auth.getClaims();
    const userId = auth?.claims?.sub;
    if (!userId) {
      setError("Sessão inválida.");
      setLoading(false);
      return;
    }

    const slug = slugify(name) || `org-${String(userId).slice(0, 8)}`;
    const { data: tenantId, error: rpcError } = await supabase.rpc(
      "create_tenant_with_owner",
      {
        p_name: name.trim(),
        p_slug: slug,
      },
    );

    if (rpcError || !tenantId) {
      setLoading(false);
      setError(mapCreateTenantError(rpcError?.message));
      return;
    }

    const activate = await fetch("/api/tenant/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId }),
    });

    setLoading(false);

    if (!activate.ok) {
      const data = (await activate.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(
        data.error ||
          "Organização criada, mas não foi possível ativá-la. Selecione-a no menu.",
      );
      router.refresh();
      return;
    }

    setName("");
    router.refresh();
    router.push("/dashboard");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-2">
        <Label htmlFor="tenant">Nova organização</Label>
        <Input
          id="tenant"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome da empresa"
        />
      </div>
      <Button type="submit" disabled={loading}>
        {loading ? "Criando..." : "Criar"}
      </Button>
      {error ? <p className="text-sm text-destructive sm:basis-full">{error}</p> : null}
    </form>
  );
}
