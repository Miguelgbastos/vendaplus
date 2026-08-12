import {
  cachedDashboardQuery,
  dashboardFilterCacheKey,
} from "@/lib/dashboard-cache";
import { type DashboardFilters } from "@/lib/dashboard-filters";
import {
  fetchDashboardCommercialOutcomes,
  fetchDashboardDimensionPerformance,
  fetchDashboardLossReasons,
  fetchDashboardRecentLeads,
  fetchDashboardStageCounts,
  fetchDashboardStageDwell,
  fetchDashboardTrend,
} from "@/lib/dashboard-rpc";
import type {
  DashboardDimensionPerformanceRow,
  DashboardStageCountsRow,
  QualificationStage,
} from "@/types/database";

export type FunnelPoint = {
  stage: string;
  count: number;
  conversion: number | null;
};

export type CampaignPoint = {
  name: string;
  leads: number;
  mql: number;
  sal: number;
  sql: number;
  oportunidade: number;
  negociacao: number;
  venda: number;
  perda: number;
  leadToSql: number;
  leadToOpportunity: number;
};

export type MarketingAnalytics = {
  summary: {
    leads: number;
    mql: number;
    sal: number;
    sql: number;
    oportunidade: number;
    leadToSql: number;
    leadToOpportunity: number;
    utmCoverage: number;
  };
  funnel: FunnelPoint[];
  trend: Array<Record<string, string | number>>;
  campaigns: CampaignPoint[];
  creatives: Array<{ name: string; leads: number; sql: number; conversion: number }>;
  sources: Array<{ name: string; leads: number; sql: number }>;
  coverage: Array<{ name: string; value: number }>;
};

export type CommercialAnalytics = {
  filteredLeads: number;
  summary: {
    sql: number;
    oportunidade: number;
    negociacao: number;
    venda: number;
    perda: number;
    /** Closed as won within the selected period (by Kommo closed_at). */
    vendaFechada: number;
    /** Closed as lost within the selected period (by Kommo closed_at). */
    perdaFechada: number;
    /** Created and closed as won within the same selected period. */
    vendaMesmoPeriodo: number;
    /** Created and closed as lost within the same selected period. */
    perdaMesmoPeriodo: number;
    sqlToOpportunity: number;
    opportunityToNegotiation: number;
    negotiationToSale: number;
  };
  funnel: FunnelPoint[];
  campaigns: CampaignPoint[];
  lossReasons: Array<{ name: string; value: number }>;
  stageDwell: Array<{
    stage: string;
    openLeads: number;
    medianCurrentDays: number | null;
    stuck7d: number;
    completedStays: number;
    medianCycleDays: number | null;
  }>;
  recent: Array<{
    id: string;
    kommoLeadId: string | null;
    name: string;
    qualification: QualificationStage | null;
    campaign: string;
    lossReason: string | null;
    updatedAt: string;
  }>;
};

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function dimension(value: string | null, fallback: string) {
  const clean = value?.trim();
  if (!clean) return fallback;
  return clean.replace(/_/g, " ");
}

function funnelFromCounts(
  counts: DashboardStageCountsRow,
  stages: QualificationStage[],
): FunnelPoint[] {
  return stages.map((stage, index) => ({
    stage,
    count: counts[stage],
    conversion:
      index === 0 ? null : percent(counts[stage], counts[stages[index - 1]]),
  }));
}

function toCampaignPoints(
  rows: DashboardDimensionPerformanceRow[],
): CampaignPoint[] {
  return rows.map((row) => ({
    ...row,
    leadToSql: percent(row.sql, row.leads),
    leadToOpportunity: percent(row.oportunidade, row.leads),
  }));
}

export async function loadMarketingAnalytics(
  tenantId: string,
  filters: DashboardFilters,
): Promise<MarketingAnalytics> {
  return cachedDashboardQuery(
    "marketing",
    tenantId,
    dashboardFilterCacheKey(filters),
    (supabase) => loadMarketingAnalyticsUncached(supabase, tenantId, filters),
  );
}

async function loadMarketingAnalyticsUncached(
  supabase: Parameters<typeof fetchDashboardStageCounts>[0],
  tenantId: string,
  filters: DashboardFilters,
): Promise<MarketingAnalytics> {
  const [counts, campaignRows, creativeRows, sourceRows, trendRows] =
    await Promise.all([
      fetchDashboardStageCounts(supabase, tenantId, filters),
      fetchDashboardDimensionPerformance(
        supabase,
        tenantId,
        filters,
        "campaign",
        "Sem campanha",
      ),
      fetchDashboardDimensionPerformance(
        supabase,
        tenantId,
        filters,
        "content",
        "Sem conteúdo",
      ),
      fetchDashboardDimensionPerformance(
        supabase,
        tenantId,
        filters,
        "source",
        "Sem origem",
      ),
      fetchDashboardTrend(supabase, tenantId, filters),
    ]);

  const trendMap = new Map<string, Record<string, string | number>>();
  for (const point of trendRows) {
    if (point.day < filters.from || point.day > filters.to) continue;
    const row = trendMap.get(point.day) ?? { date: point.day };
    row[point.stage] = Number(row[point.stage] ?? 0) + point.total;
    trendMap.set(point.day, row);
  }

  const leadsTotal = counts.leads_total;
  const completeUtms = counts.utm_complete;

  return {
    summary: {
      leads: leadsTotal,
      mql: counts.mql,
      sal: counts.sal,
      sql: counts.sql,
      oportunidade: counts.oportunidade,
      leadToSql: percent(counts.sql, leadsTotal),
      leadToOpportunity: percent(counts.oportunidade, leadsTotal),
      utmCoverage: percent(completeUtms, leadsTotal),
    },
    funnel: funnelFromCounts(counts, ["mql", "sal", "sql", "oportunidade"]),
    trend: [...trendMap.values()].sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    ),
    campaigns: toCampaignPoints(campaignRows),
    creatives: creativeRows
      .filter((row) => row.leads >= 3)
      .map((row) => ({
        name: row.name,
        leads: row.leads,
        sql: row.sql,
        conversion: percent(row.sql, row.leads),
      }))
      .sort((a, b) => b.sql - a.sql)
      .slice(0, 10),
    sources: sourceRows.map((row) => ({
      name: row.name,
      leads: row.leads,
      sql: row.sql,
    })),
    coverage: [
      { name: "UTMs completas", value: completeUtms },
      { name: "UTMs incompletas", value: leadsTotal - completeUtms },
    ],
  };
}

export async function loadCommercialAnalytics(
  tenantId: string,
  filters: DashboardFilters,
): Promise<CommercialAnalytics> {
  return cachedDashboardQuery(
    "commercial",
    tenantId,
    dashboardFilterCacheKey(filters),
    (supabase) => loadCommercialAnalyticsUncached(supabase, tenantId, filters),
  );
}

async function loadCommercialAnalyticsUncached(
  supabase: Parameters<typeof fetchDashboardStageCounts>[0],
  tenantId: string,
  filters: DashboardFilters,
): Promise<CommercialAnalytics> {
  const [counts, outcomes, campaignRows, lossReasons, dwellRows, recentRows] =
    await Promise.all([
      fetchDashboardStageCounts(supabase, tenantId, filters),
      fetchDashboardCommercialOutcomes(supabase, tenantId, filters),
      fetchDashboardDimensionPerformance(
        supabase,
        tenantId,
        filters,
        "campaign",
        "Sem campanha",
      ),
      fetchDashboardLossReasons(supabase, tenantId, filters),
      fetchDashboardStageDwell(supabase, tenantId, filters),
      fetchDashboardRecentLeads(supabase, tenantId, filters, 20),
    ]);

  return {
    filteredLeads: counts.leads_total,
    summary: {
      sql: counts.sql,
      oportunidade: counts.oportunidade,
      negociacao: counts.negociacao,
      venda: counts.venda,
      perda: counts.perda,
      vendaFechada: outcomes.venda_fechada,
      perdaFechada: outcomes.perda_fechada,
      vendaMesmoPeriodo: outcomes.venda_mesmo_periodo,
      perdaMesmoPeriodo: outcomes.perda_mesmo_periodo,
      sqlToOpportunity: percent(counts.oportunidade, counts.sql),
      opportunityToNegotiation: percent(counts.negociacao, counts.oportunidade),
      negotiationToSale: percent(counts.venda, counts.negociacao),
    },
    funnel: funnelFromCounts(counts, [
      "sql",
      "oportunidade",
      "negociacao",
      "venda",
    ]),
    campaigns: toCampaignPoints(campaignRows),
    lossReasons,
    stageDwell: dwellRows.map((row) => ({
      stage: row.stage,
      openLeads: row.open_leads,
      medianCurrentDays:
        row.median_current_days == null ? null : Number(row.median_current_days),
      stuck7d: row.stuck_7d,
      completedStays: row.completed_stays,
      medianCycleDays:
        row.median_cycle_days == null ? null : Number(row.median_cycle_days),
    })),
    recent: recentRows.map((lead) => ({
      id: lead.id,
      kommoLeadId: lead.kommo_lead_id,
      name: lead.name || `Lead #${lead.kommo_lead_id}`,
      qualification: lead.qualification,
      campaign: dimension(lead.utm_campaign, "Sem campanha"),
      lossReason: lead.loss_reason,
      updatedAt: lead.updated_at,
    })),
  };
}
