"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BackfillLossHistoryButton({
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

  async function enqueue() {
    setBusy(true);
    setError(false);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/kommo/backfill-loss-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, limit: 50 }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        enqueued?: number;
      };

      if (!response.ok) {
        setError(true);
        setMessage(body.error || "Falha ao enfileirar o backfill.");
        return;
      }

      const count = body.enqueued ?? 0;
      setMessage(
        count === 0
          ? "Nenhum lead sem histórico comercial pendente neste lote."
          : `${count} lead(s) enfileirado(s). O worker preenche o histórico em segundo plano.`,
      );
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
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={disabled || busy}
        onClick={enqueue}
      >
        <History aria-hidden="true" className="size-3.5" />
        {busy ? "Enfileirando…" : "Preencher histórico de perdas"}
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
