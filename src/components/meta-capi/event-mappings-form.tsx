"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { QualificationStage } from "@/types/database";

type Mapping = {
  qualification: QualificationStage;
  event_name: string;
  include_value: boolean;
  currency: string;
  is_active: boolean;
  action_source: string;
};

const QUALIFICATION_LABELS: Record<QualificationStage, string> = {
  mql: "MQL",
  sal: "SAL",
  sql: "SQL",
  oportunidade: "Oportunidade",
  negociacao: "Negociação",
  venda: "Venda (Purchase)",
  perda: "Perda",
};

export function MetaCapiEventMappingsForm({
  tenantId,
  initialMappings,
}: {
  tenantId: string;
  initialMappings: Mapping[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Mapping[]>(initialMappings);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function updateRow(qualification: QualificationStage, patch: Partial<Mapping>) {
    setRows((prev) =>
      prev.map((r) => (r.qualification === qualification ? { ...r, ...patch } : r)),
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    const res = await fetch("/api/meta-capi/events", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId, mappings: rows }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "Não foi possível salvar os mapeamentos.");
      return;
    }
    setSuccess("Mapeamentos salvos.");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Qualificação</th>
              <th className="px-3 py-2 text-left font-medium">Evento CAPI</th>
              <th className="px-3 py-2 text-left font-medium">Enviar valor</th>
              <th className="px-3 py-2 text-left font-medium">Moeda</th>
              <th className="px-3 py-2 text-left font-medium">Ativo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.qualification} className="border-t border-border">
                <td className="px-3 py-2 text-foreground">
                  {QUALIFICATION_LABELS[row.qualification]}
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={row.event_name}
                    onChange={(e) =>
                      updateRow(row.qualification, { event_name: e.target.value })
                    }
                    className="h-8"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={row.include_value}
                    onChange={(e) =>
                      updateRow(row.qualification, {
                        include_value: e.target.checked,
                      })
                    }
                    aria-label={`Enviar valor em ${QUALIFICATION_LABELS[row.qualification]}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={row.currency}
                    onChange={(e) =>
                      updateRow(row.qualification, {
                        currency: e.target.value.toUpperCase(),
                      })
                    }
                    maxLength={3}
                    className="h-8 w-20 uppercase"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={row.is_active}
                    onChange={(e) =>
                      updateRow(row.qualification, { is_active: e.target.checked })
                    }
                    aria-label={`Ativar envio ${QUALIFICATION_LABELS[row.qualification]}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error ? (
        <p className="rounded-lg alert-error px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-lg alert-success px-3 py-2 text-sm" role="status">
          {success}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={loading}>
          {loading ? "Salvando..." : "Salvar mapeamentos"}
        </Button>
        <Label htmlFor="" className="text-xs text-muted-foreground">
          Nomes de evento seguem o padrão do Meta (Lead, Purchase, InitiateCheckout…)
          ou nomes customizados definidos no Events Manager.
        </Label>
      </div>
    </form>
  );
}
