import { createClient } from "@/lib/supabase/server";
import {
  applyLeadFilters,
  leadReachedStages,
  ymdInSaoPaulo,
  type DashboardFilters,
} from "@/lib/dashboard-filters";
import {
  loadDashboardFilterOptions,
  type DashboardFilterOptions,
} from "@/lib/dashboard-filter-options";
import {
  fetchAllFilteredLeads,
  fetchFilteredQualificationEvents,
} from "@/lib/dashboard-query";
import type { QualificationStage } from "@/types/database";

const STAGES: QualificationStage[] = [
  "mql",
  "sal",
  "sql",
  "oportunidade",
  "negociacao",
  "venda",
  "perda",
];

type LeadRow = {
  id: string;
  kommo_lead_id: string | null;
  name: string | null;
  qualification: QualificationStage | null;
  price: number | string | null;
  status_name: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  responsible_user_id: string | null;
  custom_fields: Record<string, unknown> | null;
  first_seen_at: string;
  updated_at: string;
};

type QualificationEvent = {
  lead_id: string;
  to_qualification: QualificationStage;
  changed_at: string;
  metadata: Record<string, unknown> | null;
};

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
    sqlToOpportunity: number;
    opportunityToNegotiation: number;
    negotiationToSale: number;
  };
  funnel: FunnelPoint[];
  campaigns: CampaignPoint[];
  lossReasons: Array<{ name: string; value: number }>;
  aging: Array<{ name: string; value: number }>;
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

function reachedStages(lead: LeadRow) {
  return leadReachedStages(lead);
}

function lossReason(lead: LeadRow) {
  const custom = lead.custom_fields ?? {};
  for (const [key, value] of Object.entries(custom)) {
    const normalized = key
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_");
    if (
      ["motivo_de_perda", "motivo_perda", "loss_reason"].includes(normalized) &&
      value != null &&
      String(value).trim()
    ) {
      return String(value).trim();
    }
  }
  return null;
}

function stageCounts(leads: LeadRow[]) {
  return Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      leads.filter((lead) => reachedStages(lead).has(stage)).length,
    ]),
  ) as Record<QualificationStage, number>;
}

function funnelFromCounts(
  counts: Record<QualificationStage, number>,
  stages: QualificationStage[],
) {
  return stages.map((stage, index) => ({
    stage,
    count: counts[stage],
    conversion:
      index === 0 ? null : percent(counts[stage], counts[stages[index - 1]]),
  }));
}

function campaignPerformance(leads: LeadRow[]) {
  const groups = new Map<string, LeadRow[]>();
  for (const lead of leads) {
    const name = dimension(lead.utm_campaign, "Sem campanha");
    groups.set(name, [...(groups.get(name) ?? []), lead]);
  }
  return [...groups.entries()]
    .map(([name, rows]) => {
      const counts = stageCounts(rows);
      return {
        name,
        leads: rows.length,
        ...counts,
        leadToSql: percent(counts.sql, rows.length),
        leadToOpportunity: percent(counts.oportunidade, rows.length),
      };
    })
    .sort((a, b) => b.leads - a.leads);
}

async function loadAnalyticsRows(
  tenantId: string,
  filters: DashboardFilters,
  options: { includeEvents: boolean },
) {
  const supabase = await createClient();
  const leadsPromise = fetchAllFilteredLeads<LeadRow>(
    supabase,
    tenantId,
    filters,
    "id, kommo_lead_id, name, qualification, price, status_name, utm_source, utm_medium, utm_campaign, utm_content, utm_term, responsible_user_id, custom_fields, first_seen_at, updated_at",
  );

  const [leads, events] = await Promise.all([
    leadsPromise,
    options.includeEvents
      ? fetchFilteredQualificationEvents<QualificationEvent>(
          supabase,
          tenantId,
          filters,
          "lead_id, to_qualification, changed_at, metadata",
        )
      : Promise.resolve([] as QualificationEvent[]),
  ]);

  const filteredLeads = applyLeadFilters(leads, filters);
  const leadIds = new Set(filteredLeads.map((lead) => lead.id));
  const filteredEvents = events.filter((event) => leadIds.has(event.lead_id));

  return {
    leads: filteredLeads,
    events: filteredEvents,
  };
}

export type MarketingAnalyticsBundle = {
  data: MarketingAnalytics;
  filterOptions: DashboardFilterOptions;
};

export type CommercialAnalyticsBundle = {
  data: CommercialAnalytics;
  filterOptions: DashboardFilterOptions;
};

export async function loadMarketingAnalytics(
  tenantId: string,
  filters: DashboardFilters,
): Promise<MarketingAnalyticsBundle> {
  const [{ leads, events }, filterOptions] = await Promise.all([
    loadAnalyticsRows(tenantId, filters, { includeEvents: true }),
    loadDashboardFilterOptions(tenantId, filters),
  ]);
  const counts = stageCounts(leads);
  const campaigns = campaignPerformance(leads);

  const trendMap = new Map<string, Record<string, string | number>>();
  for (const event of events) {
    if (event.metadata?.inferred === true || event.metadata?.inferred === "true") {
      continue;
    }
    // Bucket by São Paulo calendar day (SQL bounds use the same timezone).
    const day = ymdInSaoPaulo(event.changed_at);
    if (!day || day < filters.from || day > filters.to) continue;
    const row = trendMap.get(day) ?? { date: day };
    row[event.to_qualification] = Number(row[event.to_qualification] ?? 0) + 1;
    trendMap.set(day, row);
  }

  const creativeGroups = new Map<string, LeadRow[]>();
  const sourceGroups = new Map<string, LeadRow[]>();
  for (const lead of leads) {
    const creative = dimension(lead.utm_content, "Sem conteúdo");
    creativeGroups.set(creative, [...(creativeGroups.get(creative) ?? []), lead]);
    const source = dimension(lead.utm_source, "Sem origem");
    sourceGroups.set(source, [...(sourceGroups.get(source) ?? []), lead]);
  }

  const completeUtms = leads.filter(
    (lead) =>
      lead.utm_source &&
      lead.utm_medium &&
      lead.utm_campaign &&
      lead.utm_content &&
      lead.utm_term,
  ).length;

  return {
    data: {
      summary: {
        leads: leads.length,
        mql: counts.mql,
        sal: counts.sal,
        sql: counts.sql,
        oportunidade: counts.oportunidade,
        leadToSql: percent(counts.sql, leads.length),
        leadToOpportunity: percent(counts.oportunidade, leads.length),
        utmCoverage: percent(completeUtms, leads.length),
      },
      funnel: funnelFromCounts(counts, ["mql", "sal", "sql", "oportunidade"]),
      trend: [...trendMap.values()].sort((a, b) =>
        String(a.date).localeCompare(String(b.date)),
      ),
      campaigns,
      creatives: [...creativeGroups.entries()]
        .map(([name, rows]) => {
          const sql = rows.filter((lead) => reachedStages(lead).has("sql")).length;
          return { name, leads: rows.length, sql, conversion: percent(sql, rows.length) };
        })
        .filter((row) => row.leads >= 3)
        .sort((a, b) => b.sql - a.sql)
        .slice(0, 10),
      sources: [...sourceGroups.entries()]
        .map(([name, rows]) => ({
          name,
          leads: rows.length,
          sql: rows.filter((lead) => reachedStages(lead).has("sql")).length,
        }))
        .sort((a, b) => b.leads - a.leads),
      coverage: [
        { name: "UTMs completas", value: completeUtms },
        { name: "UTMs incompletas", value: leads.length - completeUtms },
      ],
    },
    filterOptions,
  };
}

export async function loadCommercialAnalytics(
  tenantId: string,
  filters: DashboardFilters,
): Promise<CommercialAnalyticsBundle> {
  const [{ leads }, filterOptions] = await Promise.all([
    loadAnalyticsRows(tenantId, filters, { includeEvents: false }),
    loadDashboardFilterOptions(tenantId, filters),
  ]);
  const counts = stageCounts(leads);
  const commercial = leads.filter((lead) =>
    ["sql", "oportunidade", "negociacao", "venda", "perda"].some((stage) =>
      reachedStages(lead).has(stage as QualificationStage),
    ),
  );
  const reasons = new Map<string, number>();
  for (const lead of leads) {
    const reason = lossReason(lead);
    if (reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  const now = Date.now();
  const aging = [
    { name: "Até 3 dias", min: 0, max: 3 },
    { name: "4–7 dias", min: 3, max: 7 },
    { name: "8–14 dias", min: 7, max: 14 },
    { name: "15+ dias", min: 14, max: Infinity },
  ].map((bucket) => ({
    name: bucket.name,
    value: commercial.filter((lead) => {
      const days = (now - new Date(lead.updated_at).getTime()) / 86_400_000;
      return days > bucket.min && days <= bucket.max;
    }).length,
  }));

  return {
    data: {
      filteredLeads: leads.length,
      summary: {
        sql: counts.sql,
        oportunidade: counts.oportunidade,
        negociacao: counts.negociacao,
        venda: counts.venda,
        perda: counts.perda,
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
      campaigns: campaignPerformance(leads),
      lossReasons: [...reasons.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value),
      aging,
      recent: commercial
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 20)
        .map((lead) => ({
          id: lead.id,
          kommoLeadId: lead.kommo_lead_id,
          name: lead.name || `Lead #${lead.kommo_lead_id}`,
          qualification: lead.qualification,
          campaign: dimension(lead.utm_campaign, "Sem campanha"),
          lossReason: lossReason(lead),
          updatedAt: lead.updated_at,
        })),
    },
    filterOptions,
  };
}
