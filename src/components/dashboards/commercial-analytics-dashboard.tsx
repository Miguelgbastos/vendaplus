"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CircleDollarSign, Clock3, Goal, Trophy } from "lucide-react";
import type { CommercialAnalytics } from "@/lib/dashboard-analytics";
import { LOSS_PREVIOUS_STAGE_LABELS } from "@/lib/commercial-loss-intelligence";
import { formatNumber } from "@/lib/utils";
import { CHART_COLORS, ChartCard, EmptyChart, FiltersEmptyState, MetricCard, SampleNote, percentLabel } from "./analytics-ui";

const stageNames: Record<string, string> = { sql: "SQL", oportunidade: "Oportunidade", negociacao: "Negociação", venda: "Venda" };
const dwellStageNames: Record<string, string> = { mql: "MQL", sal: "SAL", sql: "SQL", oportunidade: "Oportunidade", negociacao: "Negociação" };

function daysLabel(value: number | null) {
  if (value == null) return "Sem histórico confiável";
  return `${formatNumber(value)} dias`;
}

export function CommercialAnalyticsDashboard({
  data,
  empty = false,
}: {
  data: CommercialAnalytics;
  empty?: boolean;
}) {
  if (empty) {
    return <FiltersEmptyState />;
  }

  const funnel = data.funnel.map((item) => ({ ...item, stage: stageNames[item.stage] ?? item.stage }));
  const campaignRows = data.campaigns.filter((row) => row.sql > 0).slice(0, 10);
  const stageDwell = data.stageDwell
    .filter((row) => row.openLeads > 0 || row.completedStays > 0)
    .map((row) => ({
      ...row,
      stage: dwellStageNames[row.stage] ?? row.stage,
      medianCurrentDays: row.medianCurrentDays,
      medianCycleDays: row.medianCycleDays,
    }));
  const dwellIsEmpty = stageDwell.length === 0;
  const lossPreviousTotal = data.lossPreviousStage.reduce((sum, row) => sum + row.value, 0);
  const ownerConversionRows = data.ownerConversion.slice(0, 12);
  const matrix = data.lossStageReasonMatrix;
  const matrixHasData = matrix.reasons.length > 0 && Object.values(matrix.matrix).some((row) =>
    Object.values(row).some((value) => value > 0),
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="SQL" value={data.summary.sql} detail="Leads que chegaram à qualificação" icon={<Goal className="size-4" />} />
        <MetricCard label="SQL → Oportunidade" value={percentLabel(data.summary.sqlToOpportunity)} detail={`${formatNumber(data.summary.oportunidade)} oportunidades`} icon={<Trophy className="size-4" />} />
        <MetricCard label="Oportunidade → Negociação" value={percentLabel(data.summary.opportunityToNegotiation)} detail={`${formatNumber(data.summary.negociacao)} negociações`} icon={<CircleDollarSign className="size-4" />} />
        <MetricCard label="Negociação → Venda" value={percentLabel(data.summary.negotiationToSale)} detail={`${formatNumber(data.summary.venda)} vendas registradas`} icon={<Trophy className="size-4" />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <ChartCard title="Conversão comercial" description="Volume acumulado e taxa entre etapas" className="xl:col-span-3">
          {data.summary.sql === 0 ? <EmptyChart /> : <><div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={funnel} margin={{ left: -20, right: 10, top: 12 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e3dc" /><XAxis dataKey="stage" tickLine={false} axisLine={false} fontSize={12} /><YAxis tickLine={false} axisLine={false} allowDecimals={false} fontSize={12} /><Tooltip /><Bar dataKey="count" name="Leads" fill={CHART_COLORS.blue} radius={[7, 7, 0, 0]} /></BarChart></ResponsiveContainer></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{funnel.map((item) => <div key={item.stage} className="rounded-lg bg-muted/60 p-3"><p className="text-xs text-muted-foreground">{item.stage}</p><p className="mt-1 font-semibold">{formatNumber(item.count)}</p><p className="text-xs text-primary">{item.conversion == null ? "Base" : `${percentLabel(item.conversion)} da etapa anterior`}</p></div>)}</div></>}
        </ChartCard>
        <ChartCard title="Tempo por etapa" description="Mediana de dias parado agora e do ciclo até sair da etapa" className="xl:col-span-2">
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-4" />Ajuda a priorizar etapas em que os leads estão travando.</div>
          {dwellIsEmpty ? (
            <EmptyChart />
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stageDwell} margin={{ left: -20, right: 10, top: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e3dc" />
                    <XAxis dataKey="stage" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis tickLine={false} axisLine={false} fontSize={12} unit="d" />
                    <Tooltip formatter={(value) => `${value ?? 0} dias`} />
                    <Legend verticalAlign="top" align="center" height={28} />
                    <Bar dataKey="medianCurrentDays" name="Parado agora (mediana)" fill={CHART_COLORS.amber} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="medianCycleDays" name="Ciclo até sair (mediana)" fill={CHART_COLORS.blue} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {stageDwell.map((row) => (
                  <div key={row.stage} className="rounded-lg bg-muted/60 p-2.5">
                    <p className="text-xs text-muted-foreground">{row.stage}</p>
                    <p className="mt-0.5 text-sm font-semibold">{formatNumber(row.openLeads)} abertos</p>
                    <p className="text-xs text-destructive">{formatNumber(row.stuck7d)} há 7+ dias</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </ChartCard>
      </div>

      <ChartCard title="Resultado comercial por campanha" description="Qualidade das campanhas da entrada até o fechamento">
        <SampleNote />
        {campaignRows.length === 0 ? (
          <div className="mt-4"><EmptyChart /></div>
        ) : (
          <div className="mt-4 h-[28rem]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={campaignRows} margin={{ left: -15, right: 8, top: 8, bottom: 96 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e3dc" />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                  fontSize={11}
                  height={100}
                  tickMargin={6}
                />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip />
                <Legend verticalAlign="top" align="center" height={36} wrapperStyle={{ paddingBottom: 8 }} />
                <Bar dataKey="sql" name="SQL" fill={CHART_COLORS.blue} radius={[4, 4, 0, 0]} />
                <Bar dataKey="oportunidade" name="Oportunidade" fill={CHART_COLORS.violet} radius={[4, 4, 0, 0]} />
                <Bar dataKey="negociacao" name="Negociação" fill={CHART_COLORS.amber} radius={[4, 4, 0, 0]} />
                <Bar dataKey="venda" name="Venda" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Motivos de perda" description="Distribuição do campo personalizado de lista da Kommo">
          {data.lossReasons.length === 0 ? <EmptyChart text="Nenhum motivo de perda foi registrado ainda." /> : <div className="h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.lossReasons.slice(0, 10)} layout="vertical" margin={{ left: 35 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e7e3dc" /><XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} /><YAxis type="category" dataKey="name" width={140} tickLine={false} axisLine={false} fontSize={11} /><Tooltip /><Bar dataKey="value" name="Perdas" fill={CHART_COLORS.rose} radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></div>}
        </ChartCard>
        <ChartCard
          title="Resumo de desfechos"
          description="Fechados no período vs criados e fechados no mesmo período"
        >
          <div className="grid h-80 content-center gap-4 sm:grid-cols-2">
            <div className="rounded-xl border bg-primary-soft/60 p-6">
              <p className="text-sm text-muted-foreground">Vendas</p>
              <p className="mt-2 font-display text-4xl font-semibold text-primary">
                {formatNumber(data.summary.vendaFechada)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Fechadas no período
              </p>
              <p className="mt-4 text-2xl font-semibold text-primary">
                {formatNumber(data.summary.vendaMesmoPeriodo)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Criadas e fechadas no período
              </p>
            </div>
            <div className="rounded-xl border bg-destructive-foreground p-6">
              <p className="text-sm text-muted-foreground">Perdas</p>
              <p className="mt-2 font-display text-4xl font-semibold text-destructive">
                {formatNumber(data.summary.perdaFechada)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Fechadas no período
              </p>
              <p className="mt-4 text-2xl font-semibold text-destructive">
                {formatNumber(data.summary.perdaMesmoPeriodo)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Criadas e fechadas no período
              </p>
            </div>
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard
          title="Perda por etapa anterior"
          description="Última perda de cada lead no período (evento de histórico), incluindo reabertos/vendidos depois"
        >
          {lossPreviousTotal === 0 ? (
            <EmptyChart text="Nenhuma perda no período." />
          ) : (
            <>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.lossPreviousStage}
                    layout="vertical"
                    margin={{ left: 35 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e7e3dc" />
                    <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={140}
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                    />
                    <Tooltip />
                    <Bar dataKey="value" name="Perdas" fill={CHART_COLORS.rose} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {data.lossPreviousStage.map((row) => (
                  <div key={row.stage} className="rounded-lg bg-muted/60 p-3">
                    <p className="text-xs text-muted-foreground">{row.name}</p>
                    <p className="mt-1 font-semibold">{formatNumber(row.value)}</p>
                    <p className="text-xs text-primary">{percentLabel(row.percent)}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </ChartCard>

        <ChartCard
          title="Ciclo até desfecho"
          description="Mediana até venda/perda e perdas recuperadas que voltaram ao funil"
        >
          {!data.closeCycle.hasReliableHistory && data.closeCycle.recoveredToVenda === 0 ? (
            <EmptyChart text="Sem histórico confiável de ciclo até desfecho no período." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border bg-muted/40 p-5">
                <p className="text-sm text-muted-foreground">Mediana até venda</p>
                <p className="mt-2 font-display text-3xl font-semibold text-primary">
                  {daysLabel(data.closeCycle.medianDaysToVenda)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {data.closeCycle.vendaSampleSize > 0
                    ? `${formatNumber(data.closeCycle.vendaSampleSize)} ciclos com histórico`
                    : "Sem histórico confiável"}
                </p>
              </div>
              <div className="rounded-xl border bg-muted/40 p-5">
                <p className="text-sm text-muted-foreground">Mediana até perda</p>
                <p className="mt-2 font-display text-3xl font-semibold text-destructive">
                  {daysLabel(data.closeCycle.medianDaysToPerda)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {data.closeCycle.perdaSampleSize > 0
                    ? `${formatNumber(data.closeCycle.perdaSampleSize)} ciclos com histórico`
                    : "Sem histórico confiável"}
                </p>
              </div>
              <div className="rounded-xl border bg-primary-soft/50 p-5">
                <p className="text-sm text-muted-foreground">Perdas recuperadas</p>
                <p className="mt-2 font-display text-3xl font-semibold text-primary">
                  {formatNumber(data.closeCycle.recoveredToVenda)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Voltaram ao funil e chegaram a venda no período
                </p>
              </div>
            </div>
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="Matriz etapa anterior × motivo da perda"
        description="Mesma população deduplicada das barras; Sem histórico / Sem motivo; motivos limitados"
      >
        {!matrixHasData ? (
          <EmptyChart text="Sem perdas no período para montar a matriz." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pb-3 pr-3 font-medium">Etapa anterior</th>
                  {matrix.reasons.map((reason) => (
                    <th key={reason} className="pb-3 px-2 font-medium">{reason}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.stages.map((stage) => (
                  <tr key={stage} className="border-t">
                    <td className="py-3 pr-3 font-medium">
                      {matrix.stageLabels[stage] ??
                        LOSS_PREVIOUS_STAGE_LABELS[
                          stage as keyof typeof LOSS_PREVIOUS_STAGE_LABELS
                        ] ??
                        stage}
                    </td>
                    {matrix.reasons.map((reason) => (
                      <td key={`${stage}-${reason}`} className="px-2 py-3 text-muted-foreground">
                        {formatNumber(matrix.matrix[stage]?.[reason] ?? 0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      <ChartCard
        title="Leads comerciais parados"
        description="Abertos (SQL/Oportunidade/Negociação) parados 3+ dias; o filtro de data limita leads com first_seen no período"
      >
        {data.stagnantOpen.length === 0 ? (
          <EmptyChart text="Nenhum lead comercial aberto parado há 3+ dias com first_seen no período/filtros." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pb-3 font-medium">Responsável</th>
                  <th className="pb-3 font-medium">Estágio</th>
                  <th className="pb-3 text-right font-medium">3–6d</th>
                  <th className="pb-3 text-right font-medium">7–14d</th>
                  <th className="pb-3 text-right font-medium">15–29d</th>
                  <th className="pb-3 text-right font-medium">30+</th>
                  <th className="pb-3 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.stagnantOpen.slice(0, 40).map((row) => (
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
        )}
      </ChartCard>

      <ChartCard
        title="Conversão por responsável"
        description="Volumes SQL, oportunidade, negociação, venda e taxa SQL→Venda"
      >
        {ownerConversionRows.length === 0 ? (
          <EmptyChart />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pb-3 font-medium">Responsável</th>
                  <th className="pb-3 text-right font-medium">SQL</th>
                  <th className="pb-3 text-right font-medium">Oportunidade</th>
                  <th className="pb-3 text-right font-medium">Negociação</th>
                  <th className="pb-3 text-right font-medium">Venda</th>
                  <th className="pb-3 text-right font-medium">SQL→Venda</th>
                </tr>
              </thead>
              <tbody>
                {ownerConversionRows.map((row) => (
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
        )}
      </ChartCard>

      <ChartCard title="Leads comerciais recentes" description="Últimas atualizações a partir de SQL, com campanha e motivo de perda">
        {data.recent.length === 0 ? <EmptyChart /> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="text-muted-foreground"><tr><th className="pb-3 font-medium">Lead</th><th className="pb-3 font-medium">Qualificação</th><th className="pb-3 font-medium">Campanha</th><th className="pb-3 font-medium">Motivo de perda</th><th className="pb-3 text-right font-medium">Atualizado</th></tr></thead><tbody>{data.recent.map((lead) => <tr key={lead.id} className="border-t"><td className="py-3 pr-4 font-medium">{lead.name}</td><td className="py-3 pr-4 uppercase text-primary">{lead.qualification ?? "—"}</td><td className="max-w-64 py-3 pr-4">{lead.campaign}</td><td className="py-3 pr-4 text-muted-foreground">{lead.lossReason ?? "—"}</td><td className="py-3 text-right text-muted-foreground">{new Date(lead.updatedAt).toLocaleDateString("pt-BR")}</td></tr>)}</tbody></table></div>}
      </ChartCard>
    </div>
  );
}
