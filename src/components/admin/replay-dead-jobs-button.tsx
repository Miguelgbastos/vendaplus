"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ReplayDeadJobsButton({
  companyId,
  disabled,
}: {
  companyId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function replay() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/admin/jobs/replay-dead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, limit: 20 }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      replayed?: number;
    };
    setBusy(false);
    if (!response.ok) {
      setMessage(body.error || "Falha no replay.");
      return;
    }
    setMessage(`${body.replayed ?? 0} job(s) reenfileirado(s).`);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Button type="button" size="sm" disabled={disabled || busy} onClick={replay}>
        {busy ? "Reenfileirando…" : "Replay dead"}
      </Button>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
