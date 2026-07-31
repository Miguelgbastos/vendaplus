"use client";

import type { ReactNode } from "react";
import { ArrowUpRight, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatNumber } from "@/lib/utils";

export const CHART_COLORS = {
  primary: "#0f766e",
  accent: "#14b8a6",
  blue: "#2563eb",
  amber: "#d97706",
  rose: "#e11d48",
  violet: "#7c3aed",
  muted: "#d6d3d1",
};

export function MetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: number | string;
  detail: string;
  icon?: ReactNode;
}) {
  return (
    <Card className="overflow-hidden border-border/80 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <span className="rounded-lg bg-primary-soft p-2 text-primary">
            {icon ?? <ArrowUpRight className="size-4" />}
          </span>
        </div>
        <p className="mt-4 font-display text-3xl font-semibold tracking-tight">
          {typeof value === "number" ? formatNumber(value) : value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

export function ChartCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("border-border/80 shadow-sm", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function EmptyChart({ text = "Ainda não há dados suficientes para este gráfico." }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-lg border border-dashed bg-muted/30 px-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

export function SampleNote() {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>Campanhas com menos de 10 leads têm amostra pequena e devem ser interpretadas com cautela.</span>
    </div>
  );
}

export function percentLabel(value: number) {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}
