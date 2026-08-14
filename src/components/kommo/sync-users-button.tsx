"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SyncKommoUsersButton({
  tenantId,
  disabled,
}: {
  tenantId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function sync() {
    setBusy(true);
    setError(false);
    setMessage(null);

    try {
      const response = await fetch("/api/kommo/users/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        synced?: number;
      };

      if (!response.ok) {
        setError(true);
        setMessage(body.error || "Falha na sincronização.");
        return;
      }

      setMessage(`${body.synced ?? 0} usuário(s) sincronizado(s).`);
      router.refresh();
    } catch {
      setError(true);
      setMessage("Não foi possível conectar ao servidor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" size="sm" variant="secondary" disabled={disabled || busy} onClick={sync}>
        <RefreshCw aria-hidden="true" className={busy ? "size-3.5 animate-spin" : "size-3.5"} />
        {busy ? "Sincronizando…" : "Sincronizar usuários"}
      </Button>
      {message ? (
        <p
          className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
          role={error ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
