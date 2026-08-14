"use client";

import { useState } from "react";
import { CheckCircle2, Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { maskWebhookUrl } from "@/lib/kommo/webhook-url";

const REQUIRED_EVENTS = [
  "Lead adicionado",
  "Lead editado",
  "Etapa (status) do lead alterada",
  "Responsável pelo lead alterado",
] as const;

export function WebhookSetup({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <code className="block break-all rounded-lg border border-border bg-muted p-3 text-xs text-primary">
          {revealed ? value : maskWebhookUrl(value)}
        </code>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={copy}>
            <Copy aria-hidden="true" className="size-3.5" />
            {copied ? "Copiado" : "Copiar URL"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={revealed}
            onClick={() => setRevealed((current) => !current)}
          >
            {revealed ? (
              <EyeOff aria-hidden="true" className="size-3.5" />
            ) : (
              <Eye aria-hidden="true" className="size-3.5" />
            )}
            {revealed ? "Ocultar URL" : "Mostrar URL"}
          </Button>
          <span className="sr-only" role="status" aria-live="polite">
            {copied ? "URL do webhook copiada" : ""}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Mantenha esta URL em sigilo. Quem tiver acesso a ela poderá enviar eventos ao endpoint.
        </p>
      </div>

      <div className="rounded-lg border border-primary/20 bg-primary-soft p-3">
        <p className="font-medium text-foreground">Eventos que devem ser marcados no Kommo</p>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {REQUIRED_EVENTS.map((event) => (
            <li key={event} className="flex items-start gap-2 text-secondary-foreground">
              <CheckCircle2
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-primary"
              />
              <span>{event}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Configurações → Integrações → Webhooks. Depois de salvar, mova um lead de etapa
          e confirme que a quantidade de jobs volta para zero.
        </p>
      </div>
    </div>
  );
}
