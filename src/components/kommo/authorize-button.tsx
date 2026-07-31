"use client";

import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export function KommoAuthorizeButton({
  tenantId,
  enabled,
}: {
  tenantId: string;
  enabled: boolean;
}) {
  const router = useRouter();

  function authorize() {
    if (!enabled) return;
    router.push(`/api/kommo/oauth/start?tenant_id=${encodeURIComponent(tenantId)}`);
  }

  return (
    <div className="space-y-2">
      <Button type="button" size="lg" onClick={authorize} disabled={!enabled}>
        Autorizar no Kommo
        <ExternalLink className="h-4 w-4" />
      </Button>
      {!enabled ? (
        <p className="text-xs text-muted-foreground">
          Salve a configuração completa (subdomínio, Integration ID e Secret Key) antes de autorizar.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Você será redirecionado ao Kommo para conceder acesso a esta organização.
        </p>
      )}
    </div>
  );
}
