"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Megaphone, MousePointerClick, Target, Tags } from "lucide-react";
import type { MarketingAnalytics } from "@/lib/dashboard-analytics";
import { formatNumber } from "@/lib/utils";
import {
  CHART_COLORS,
  ChartCard,
  EmptyChart,
  FiltersEmptyState,
  MetricCard,
  SampleNote,
  percentLabel,
} from "./analytics-ui";

const stageNames: Record<string, string> = {
  mql: "MQL",
  sal: "SAL",
  sql: "SQL",
  oportunidade: "Oportunidade",
};

export function MarketingAnalyticsDashboard({
  data,
  empty = false,
}: {
  data: MarketingAnalytics;
  empty?: boolean;
}) {
  if (empty) {
    return <FiltersEmptyState />;
  }

  const funnel = data.funnel.map((item) => ({ ...item, stage: stageNames[item.stage] ?? item.stage }));
  const trend = data.trend.map((item) => ({
    ...item,
    date: new Date(`${item.date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
  }));
  const campaignRows = data.campaigns.slice(0, 15);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Leads captados" value={data.summary.leads} detail={`${formatNumber(data.summary.mql)} chegaram a MQL`} icon={<Megaphone className="size-4" />} />
        <MetricCard label="Lead → SQL" value={percentLabel(data.summary.leadToSql)} detail={`${formatNumber(data.summary.sql)} leads qualificados`} icon={<Target className="size-4" />} />
        <MetricCard label="Lead → Oportunidade" value={percentLabel(data.summary.leadToOpportunity)} detail={`${formatNumber(data.summary.oportunidade)} oportunidades`} icon={<MousePointerClick className="size-4" />} />
        <MetricCard label="UTMs completas" value={percentLabel(data.summary.utmCoverage)} detail="Origem, mídia, campanha, conteúdo e termo" icon={<Tags className="size-4" />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <ChartCard title="Evolução no funil" description="Volume acumulado e conversão entre qualificações" className="xl:col-span-3">
          {data.summary.leads === 0 ? <EmptyChart /> : (
            <>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnel} margin={{ left: -20, right: 10, top: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e3dc" />
                    <XAxis dataKey="stage" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickLine={false} axisLine={false} fontSize={12} allowDecimals={false} />
                    <Tooltip formatter={(value) => formatNumber(Number(value))} />
                    <Bar dataKey="count" name="Leads" fill={CHART_COLORS.primary} radius={[7, 7, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {funnel.map((item) => <div key={item.stage} className="rounded-lg bg-muted/60 p-3"><p className="text-xs text-muted-foreground">{item.stage}</p><p className="mt-1 font-semibold">{formatNumber(item.count)}</p><p className="text-xs text-primary">{item.conversion == null ? "Base" : `${percentLabel(item.conversion)} da etapa anterior`}</p></div>)}
              </div>
            </>
          )}
        </ChartCard>

        <ChartCard title="Qualidade das UTMs" description="Preenchimento dos cinco parâmetros de aquisição" className="xl:col-span-2">
          {data.summary.leads === 0 ? <EmptyChart /> : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.coverage} dataKey="value" nameKey="name" innerRadius={66} outerRadius={96} paddingAngle={3}>
                    {data.coverage.map((item, index) => <Cell key={item.name} fill={index === 0 ? CHART_COLORS.primary : CHART_COLORS.muted} />)}
                  </Pie>
                  <Tooltip formatter={(value) => formatNumber(Number(value))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
      </div>

      <ChartCard title="Qualificações ao longo do tempo" description="Novos avanços reais registrados por dia; preenchimentos retroativos não entram nesta série">
        {trend.length === 0 ? <EmptyChart text="O histórico temporal será formado conforme novos avanços forem recebidos." /> : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ left: -20, right: 16, top: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e3dc" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="mql" name="MQL" stroke={CHART_COLORS.primary} strokeWidth={2} connectNulls />
                <Line type="monotone" dataKey="sal" name="SAL" stroke={CHART_COLORS.blue} strokeWidth={2} connectNulls />
                <Line type="monotone" dataKey="sql" name="SQL" stroke={CHART_COLORS.violet} strokeWidth={2} connectNulls />
                <Line type="monotone" dataKey="oportunidade" name="Oportunidade" stroke={CHART_COLORS.amber} strokeWidth={2} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>

      <ChartCard title="Campanhas por qualidade" description="Volume e avanço no funil cruzados pela utm_campaign">
        <SampleNote />
        {campaignRows.length === 0 ? <div className="mt-4"><EmptyChart /></div> : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="text-muted-foreground"><tr><th className="pb-3 font-medium">Campanha</th><th className="pb-3 text-right font-medium">Leads</th><th className="pb-3 text-right font-medium">MQL</th><th className="pb-3 text-right font-medium">SAL</th><th className="pb-3 text-right font-medium">SQL</th><th className="pb-3 text-right font-medium">Oportunidades</th><th className="pb-3 text-right font-medium">Lead → SQL</th><th className="pb-3 text-right font-medium">Lead → Oport.</th></tr></thead>
              <tbody>{campaignRows.map((row) => <tr key={row.name} className="border-t"><td className="max-w-72 py-3 pr-4 font-medium"><span>{row.name}</span>{row.leads < 10 && <span className="ml-2 rounded-full bg-warning-foreground px-2 py-0.5 text-[10px] font-semibold text-warning">amostra pequena</span>}</td><td className="py-3 text-right">{row.leads}</td><td className="py-3 text-right">{row.mql}</td><td className="py-3 text-right">{row.sal}</td><td className="py-3 text-right">{row.sql}</td><td className="py-3 text-right">{row.oportunidade}</td><td className="py-3 text-right font-medium text-primary">{percentLabel(row.leadToSql)}</td><td className="py-3 text-right font-medium text-primary">{percentLabel(row.leadToOpportunity)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </ChartCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Criativos que geram SQL" description="Top utm_content com ao menos 3 leads">
          {data.creatives.length === 0 ? <EmptyChart /> : <div className="h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.creatives} layout="vertical" margin={{ left: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e7e3dc" /><XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} /><YAxis type="category" dataKey="name" width={130} tickLine={false} axisLine={false} fontSize={11} /><Tooltip /><Legend /><Bar dataKey="leads" name="Leads" fill={CHART_COLORS.muted} radius={[0, 5, 5, 0]} /><Bar dataKey="sql" name="SQL" fill={CHART_COLORS.primary} radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer></div>}
        </ChartCard>
        <ChartCard title="Origem dos leads qualificados" description="Volume total e SQL por utm_source">
          {data.sources.length === 0 ? <EmptyChart /> : <div className="h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.sources.slice(0, 10)} margin={{ left: -15 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e3dc" /><XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} interval={0} angle={-20} textAnchor="end" height={65} /><YAxis tickLine={false} axisLine={false} allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="leads" name="Leads" fill={CHART_COLORS.muted} radius={[5, 5, 0, 0]} /><Bar dataKey="sql" name="SQL" fill={CHART_COLORS.blue} radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div>}
        </ChartCard>
      </div>
    </div>
  );
}
