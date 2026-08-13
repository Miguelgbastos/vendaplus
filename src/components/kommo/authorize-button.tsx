"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export function KommoAuthorizeButton({
  tenantId,
  enabled,
}: {
  tenantId: string;
  enabled: boolean;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function authorize() {
    if (!enabled || starting) return;
    setStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/kommo/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        authorize_url?: string;
      };
      if (!response.ok || !body.authorize_url) {
        setError(body.error || "Não foi possível iniciar a autorização.");
        setStarting(false);
        return;
      }
      window.location.assign(body.authorize_url);
    } catch {
      setError("Falha de rede ao iniciar OAuth.");
      setStarting(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="lg"
        onClick={authorize}
        disabled={!enabled || starting}
      >
        {starting ? "Redirecionando…" : "Autorizar no Kommo"}
        <ExternalLink className="h-4 w-4" />
      </Button>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {!enabled ? (
        <p className="text-xs text-muted-foreground">
          Salve a configuração completa (subdomínio, Integration ID e Secret Key) antes de autorizar.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Você será redirecionado ao Kommo para conceder acesso a esta empresa.
        </p>
      )}
    </div>
  );
}
