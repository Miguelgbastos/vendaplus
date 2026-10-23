"use client";

import { useMemo } from "react";
import type { CampaignPoint, CommercialAnalytics } from "@/lib/dashboard-analytics";
import { LOSS_PREVIOUS_STAGE_LABELS } from "@/lib/commercial-loss-intelligence";
import { useSortableTable } from "@/hooks/use-sortable-table";
import { SortableTh } from "@/components/ui/sortable-th";
import { formatNumber } from "@/lib/utils";
import { percentLabel } from "./analytics-ui";

export function CampaignQualityTable({
  rows,
  limit = 15,
}: {
  rows: CampaignPoint[];
  limit?: number;
}) {
  const { rows: sorted, headerProps } = useSortableTable(rows, {
    name: { type: "text", value: (row) => row.name },
    leads: { type: "number", value: (row) => row.leads },
    mql: { type: "number", value: (row) => row.mql },
    sal: { type: "number", value: (row) => row.sal },
    sql: { type: "number", value: (row) => row.sql },
    oportunidade: { type: "number", value: (row) => row.oportunidade },
    leadToSql: { type: "percent", value: (row) => row.leadToSql },
    leadToOpportunity: { type: "percent", value: (row) => row.leadToOpportunity },
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[850px] text-left text-sm">
        <thead className="text-muted-foreground">
          <tr>
            <SortableTh {...headerProps("name")}>Campanha</SortableTh>
            <SortableTh align="right" {...headerProps("leads")}>Leads</SortableTh>
            <SortableTh align="right" {...headerProps("mql")}>MQL</SortableTh>
            <SortableTh align="right" {...headerProps("sal")}>SAL</SortableTh>
            <SortableTh align="right" {...headerProps("sql")}>SQL</SortableTh>
            <SortableTh align="right" {...headerProps("oportunidade")}>Oportunidades</SortableTh>
            <SortableTh align="right" {...headerProps("leadToSql")}>Lead → SQL</SortableTh>
            <SortableTh align="right" {...headerProps("leadToOpportunity")}>Lead → Oport.</SortableTh>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, limit).map((row, index) => (
            <tr key={`${row.name}-${index}`} className="border-t">
              <td className="max-w-72 py-3 pr-4 font-medium">
                <span>{row.name}</span>
                {row.leads < 10 ? (
                  <span className="ml-2 rounded-full bg-warning-foreground px-2 py-0.5 text-[10px] font-semibold text-warning">
                    amostra pequena
                  </span>
                ) : null}
              </td>
              <td className="py-3 text-right">{formatNumber(row.leads)}</td>
              <td className="py-3 text-right">{formatNumber(row.mql)}</td>
              <td className="py-3 text-right">{formatNumber(row.sal)}</td>
              <td className="py-3 text-right">{formatNumber(row.sql)}</td>
              <td className="py-3 text-right">{formatNumber(row.oportunidade)}</td>
              <td className="py-3 text-right font-medium text-primary">{percentLabel(row.leadToSql)}</td>
              <td className="py-3 text-right font-medium text-primary">{percentLabel(row.leadToOpportunity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StagnantOpenTable({
  rows,
}: {
  rows: CommercialAnalytics["stagnantOpen"];
}) {
  const { rows: sorted, headerProps } = useSortableTable(rows, {
    ownerName: { type: "text", value: (row) => row.ownerName },
    stageLabel: { type: "text", value: (row) => row.stageLabel },
    bucket3: { type: "number", value: (row) => row.bucket3 },
    bucket7: { type: "number", value: (row) => row.bucket7 },
    bucket15: { type: "number", value: (row) => row.bucket15 },
    bucket30: { type: "number", value: (row) => row.bucket30 },
    total: { type: "number", value: (row) => row.total },
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="text-muted-foreground">
          <tr>
            <SortableTh {...headerProps("ownerName")}>Responsável</SortableTh>
            <SortableTh {...headerProps("stageLabel")}>Estágio</SortableTh>
            <SortableTh align="right" {...headerProps("bucket3")}>3–6d</SortableTh>
            <SortableTh align="right" {...headerProps("bucket7")}>7–14d</SortableTh>
            <SortableTh align="right" {...headerProps("bucket15")}>15–29d</SortableTh>
            <SortableTh align="right" {...headerProps("bucket30")}>30+</SortableTh>
            <SortableTh align="right" {...headerProps("total")}>Total</SortableTh>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 40).map((row) => (
            <tr key={`${row.ownerId}-${row.stage}`} className="border-t">
              <td className="py-3 pr-4 font-medium">{row.ownerName}</td>
              <td className="py-3 pr-4">{row.stageLabel}</td>
              <td className="py-3 text-right text-muted-foreground">{formatNumber(row.bucket3)}</td>
              <td className="py-3 text-right text-muted-foreground">{formatNumber(row.bucket7)}</td>
              <td className="py-3 text-right text-muted-foreground">{formatNumber(row.bucket15)}</td>
              <td className="py-3 text-right font-medium text-destructive">{formatNumber(row.bucket30)}</td>
              <td className="py-3 text-right font-semibold">{formatNumber(row.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OwnerConversionTable({
  rows,
}: {
  rows: CommercialAnalytics["ownerConversion"];
}) {
  const { rows: sorted, headerProps } = useSortableTable(rows, {
    name: { type: "text", value: (row) => row.name },
    sql: { type: "number", value: (row) => row.sql },
    oportunidade: { type: "number", value: (row) => row.oportunidade },
    negociacao: { type: "number", value: (row) => row.negociacao },
    venda: { type: "number", value: (row) => row.venda },
    sqlToVenda: { type: "percent", value: (row) => row.sqlToVenda },
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-muted-foreground">
          <tr>
            <SortableTh {...headerProps("name")}>Responsável</SortableTh>
            <SortableTh align="right" {...headerProps("sql")}>SQL</SortableTh>
            <SortableTh align="right" {...headerProps("oportunidade")}>Oportunidade</SortableTh>
            <SortableTh align="right" {...headerProps("negociacao")}>Negociação</SortableTh>
            <SortableTh align="right" {...headerProps("venda")}>Venda</SortableTh>
            <SortableTh align="right" {...headerProps("sqlToVenda")}>SQL→Venda</SortableTh>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 12).map((row) => (
            <tr key={row.ownerId || row.name} className="border-t">
              <td className="py-3 pr-4 font-medium">{row.name}</td>
              <td className="py-3 text-right">{formatNumber(row.sql)}</td>
              <td className="py-3 text-right text-muted-foreground">{formatNumber(row.oportunidade)}</td>
              <td className="py-3 text-right text-muted-foreground">{formatNumber(row.negociacao)}</td>
              <td className="py-3 text-right font-medium text-primary">{formatNumber(row.venda)}</td>
              <td className="py-3 text-right font-semibold">{percentLabel(row.sqlToVenda)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecentCommercialLeadsTable({
  rows,
}: {
  rows: CommercialAnalytics["recent"];
}) {
  const { rows: sorted, headerProps } = useSortableTable(rows, {
    name: { type: "text", value: (row) => row.name },
    qualification: { type: "text", value: (row) => row.qualification ?? "" },
    campaign: { type: "text", value: (row) => row.campaign },
    lossReason: { type: "text", value: (row) => row.lossReason ?? "" },
    updatedAt: { type: "datetime", value: (row) => row.updatedAt },
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="text-muted-foreground">
          <tr>
            <SortableTh {...headerProps("name")}>Lead</SortableTh>
            <SortableTh {...headerProps("qualification")}>Qualificação</SortableTh>
            <SortableTh {...headerProps("campaign")}>Campanha</SortableTh>
            <SortableTh {...headerProps("lossReason")}>Motivo de perda</SortableTh>
            <SortableTh align="right" {...headerProps("updatedAt")}>Atualizado</SortableTh>
          </tr>
        </thead>
        <tbody>
          {sorted.map((lead) => (
            <tr key={lead.id} className="border-t">
              <td className="py-3 pr-4 font-medium">{lead.name}</td>
              <td className="py-3 pr-4 uppercase text-primary">{lead.qualification ?? "—"}</td>
              <td className="max-w-64 py-3 pr-4">{lead.campaign}</td>
              <td className="py-3 pr-4 text-muted-foreground">{lead.lossReason ?? "—"}</td>
              <td className="py-3 text-right text-muted-foreground">
                {new Date(lead.updatedAt).toLocaleDateString("pt-BR")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type MatrixRow = {
  stage: string;
  stageLabel: string;
  counts: Record<string, number>;
};

export function LossStageReasonMatrixTable({
  matrix,
}: {
  matrix: CommercialAnalytics["lossStageReasonMatrix"];
}) {
  const baseRows = useMemo<MatrixRow[]>(
    () =>
      matrix.stages.map((stage) => ({
        stage,
        stageLabel:
          matrix.stageLabels[stage] ??
          LOSS_PREVIOUS_STAGE_LABELS[stage as keyof typeof LOSS_PREVIOUS_STAGE_LABELS] ??
          stage,
        counts: Object.fromEntries(
          matrix.reasons.map((reason) => [reason, matrix.matrix[stage]?.[reason] ?? 0]),
        ),
      })),
    [matrix],
  );

  const accessors = useMemo(() => {
    const map: Record<string, { type: "text" | "number"; value: (row: MatrixRow) => string | number }> = {
      stageLabel: { type: "text", value: (row) => row.stageLabel },
    };
    for (const reason of matrix.reasons) {
      map[`reason:${reason}`] = {
        type: "number",
        value: (row) => row.counts[reason] ?? 0,
      };
    }
    return map;
  }, [matrix.reasons]);

  const { rows: sorted, headerProps } = useSortableTable(baseRows, accessors);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-muted-foreground">
          <tr>
            <SortableTh className="pr-3" {...headerProps("stageLabel")}>
              Etapa anterior
            </SortableTh>
            {matrix.reasons.map((reason) => (
              <SortableTh
                key={reason}
                align="right"
                className="px-2"
                {...headerProps(`reason:${reason}`)}
              >
                {reason}
              </SortableTh>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.stage} className="border-t">
              <td className="py-3 pr-3 font-medium">{row.stageLabel}</td>
              {matrix.reasons.map((reason) => (
                <td key={`${row.stage}-${reason}`} className="px-2 py-3 text-right text-muted-foreground">
                  {formatNumber(row.counts[reason] ?? 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
