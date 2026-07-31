"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrencyBRL, formatNumber } from "@/lib/utils";
import type { DashboardMetrics } from "@/types/database";

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {hint ? (
        <CardContent>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}

export function MetricsGrid({ metrics }: { metrics: DashboardMetrics }) {
  const funnel = [
    { name: "MQL", value: metrics.mql },
    { name: "SAL", value: metrics.sal },
    { name: "SQL", value: metrics.sql },
    { name: "Oportunidade", value: metrics.oportunidade },
    { name: "Negociação", value: metrics.negociacao },
    { name: "Venda", value: metrics.venda },
    { name: "Perda", value: metrics.perda },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Leads" value={formatNumber(metrics.leadsTotal)} />
        <Metric
          label="Receita fechada"
          value={formatCurrencyBRL(metrics.receitaFechada)}
        />
        <Metric
          label="Taxa de conversão"
          value={`${formatNumber(metrics.taxaConversao)}%`}
          hint="Vendas / leads totais"
        />
        <Metric label="Vendas" value={formatNumber(metrics.venda)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Funil de qualificação</CardTitle>
          <CardDescription>
            Distribuição por etapa normalizada (MQL → Venda/Perda)
          </CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funnel}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e3dc" />
              <XAxis dataKey="name" stroke="#78716c" fontSize={12} />
              <YAxis stroke="#78716c" fontSize={12} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "#ffffff",
                  border: "1px solid #e7e3dc",
                  borderRadius: 8,
                  color: "#1c1917",
                }}
              />
              <Bar dataKey="value" fill="#0f766e" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
