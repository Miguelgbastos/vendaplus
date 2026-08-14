import type { SupabaseClient } from "@supabase/supabase-js";
import {
  firstSeenRangeBounds,
  type DashboardFilters,
} from "@/lib/dashboard-filters";
import type {
  DashboardCloseCycleStatsRow,
  DashboardCommercialOutcomesRow,
  DashboardDimension,
  DashboardLossPreviousStageRow,
  DashboardLossStageReasonRow,
  DashboardNameValueRow,
  DashboardRecentLeadRow,
  DashboardStageCountsRow,
  DashboardStageDwellRow,
  DashboardStagnantOpenLeadRow,
  DashboardDimensionPerformanceRow,
  DashboardFilterOptionRow,
  DashboardTrendRow,
} from "@/types/database";

/** Shared params for the dashboard aggregate RPCs (São Paulo day bounds + dimension filters). */
function dashboardRpcParams(tenantId: string, filters: DashboardFilters) {
  const { gte, lt } = firstSeenRangeBounds(filters.from, filters.to);
  return {
    p_tenant_id: tenantId,
    p_from: gte,
    p_to: lt,
    p_campaign: filters.campaign ?? null,
    p_source: filters.source ?? null,
    p_medium: filters.medium ?? null,
    p_owner: filters.owner ?? null,
    p_stage: filters.stage ?? null,
  };
}

async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  params: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(fn, params);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

const EMPTY_STAGE_COUNTS: DashboardStageCountsRow = {
  leads_total: 0,
  mql: 0,
  sal: 0,
  sql: 0,
  oportunidade: 0,
  negociacao: 0,
  venda: 0,
  perda: 0,
  receita_fechada: 0,
  utm_complete: 0,
};

export async function fetchDashboardStageCounts(
  supabase: SupabaseClient,
  tenantId: string,
  filters: DashboardFilters,
): Promise<DashboardStageCountsRow> {
  const rows = await callRpc<DashboardStageCountsRow[]>(
    supabase,
    "dashboard_stage_counts",
    dashboardRpcParams(tenantId, filters),
  );
  const row = rows?.[0];
  if (!row) return EMPTY_STAGE_COUNTS;
  return {
    ...row,
    receita_fechada: Number(row.receita_fechada) || 0,
  };
}

const EMPTY_COMMERCIAL_OUTCOMES: DashboardCommercialOutcomesRow = {
  venda_fechada: 0,
  perda_fechada: 0,
  venda_mesmo_periodo: 0,
  perda_mesmo_periodo: 0,
};

export async function fetchDashboardCommercialOutcomes(
  supabase: SupabaseClient,
  tenantId: string,
  filters: DashboardFilters,
): Promise<DashboardCommercialOutcomesRow> {
  const rows = await callRpc<DashboardCommercialOutcomesRow[]>(
    supabase,
    "dashboard_commercial_outcomes",
    dashboardRpcParams(tenantId, filters),
  );
  return rows?.[0] ?? EMPTY_COMMERCIAL_OUTCOMES;
}

export async function fetchDashboardDimensionPerformance(
  supabase: SupabaseClient,
  tenantId: string,
  filters: DashboardFilters,
  dimension: DashboardDimension,
  fallback: string,
): Promise<DashboardDimensionPerformanceRow[]> {
  return callRpc<DashboardDimensionPerformanceRow[]>(
    supabase,
    "dashboard_dimension_performance",
    {
      ...dashboardRpcParams(tenantId, filters),
      p_dimension: dimension,
      p_fallback: fallback,
    },
  );
}

export async function fetchDashboardFilterOptionRows(
  supabase: SupabaseClient,
  tenantId: string,
  filters: Pick<DashboardFilters, "from" | "to">,
): Promise<DashboardFilterOptionRow[]> {
  const { gte, lt } = firstSeenRangeBounds(filters.from, filters.to);
  return callRpc<DashboardFilterOptionRow[]>(
    supabase,
    "dashboard_filter_options",
    { p_tenant_id: tenantId, p_from: gte, p_to: lt },
  );
}

export async function fetchDashboardTrend(
  supabase: SupabaseClient,
  tenantId: string,
  filters: DashboardFilters,
): Promise<DashboardTrendRow[]> {
  return callRpc<DashboardTrendRow[]>(
    supabase,
    "dashboard_trend",
    dashboardRpcParams(tenantId, filters),
  );
}

export async function fetchDashboardLossReasons(
  supabase: SupabaseClient,
  tenantId: string,
  filters: DashboardFilters,
): Promise<DashboardNameValueRow[]> {
  return callRpc<DashboardNameValueRow[]>(
    supabase,
    "dashboard_loss_reasons",
    dashboardRpcParams(tenantId, filters),
  );
}

export async function fetchDashboardAging(
  supabase: SupabaseClient,
  tenantId: string,
  filters: DashboardFilters,
): Promise<DashboardNameValueRow[]> {
  return callRpc<DashboardNameValueRow[]>(
    supabase,
    "dashboard_aging",
    dashboardRpcParams(tenantId, filters),
  );
}

export async function fetchDashboardStageDwell(
  supabase: SupabaseClient,
  tenantId: string,
  filters: DashboardFilters,
): Promise<DashboardStageDwellRow[]> {
  return callRpc<DashboardStageDwellRow[]>(
    supabase,
    "dashboard_stage_dwell",
    dashboardRpcParams(tenantId, filters),
  );
}

export async function fetchDashboardRecentLeads(
  supabase: SupabaseClient,
  tenantId: string,
  filters: DashboardFilters,
  limit = 20,
): Promise<DashboardRecentLeadRow[]> {
  return callRpc<DashboardRecentLeadRow[]>(
    supabase,
    "dashboard_recent_leads",
    { ...dashboardRpcParams(tenantId, filters), p_limit: limit },
  );
}

export async function fetchDashboardLossPreviousStage(
  supabase: SupabaseClient,
  tenantId: string,
  filters: DashboardFilters,
): Promise<DashboardLossPreviousStageRow[]> {
  return callRpc<DashboardLossPreviousStageRow[]>(
    supabase,
    "dashboard_loss_previous_stage",
    dashboardRpcParams(tenantId, filters),
  );
}

export async function fetchDashboardLossStageReasonMatrix(
  supabase: SupabaseClient,
  tenantId: string,
  filters: DashboardFilters,
): Promise<DashboardLossStageReasonRow[]> {
  return callRpc<DashboardLossStageReasonRow[]>(
    supabase,
    "dashboard_loss_stage_reason_matrix",
    dashboardRpcParams(tenantId, filters),
  );
}

export async function fetchDashboardStagnantOpenLeads(
  supabase: SupabaseClient,
  tenantId: string,
  filters: DashboardFilters,
): Promise<DashboardStagnantOpenLeadRow[]> {
  return callRpc<DashboardStagnantOpenLeadRow[]>(
    supabase,
    "dashboard_stagnant_open_leads",
    dashboardRpcParams(tenantId, filters),
  );
}

const EMPTY_CLOSE_CYCLE: DashboardCloseCycleStatsRow = {
  median_days_to_venda: null,
  venda_sample_size: 0,
  median_days_to_perda: null,
  perda_sample_size: 0,
  recovered_to_venda: 0,
};

export async function fetchDashboardCloseCycleStats(
  supabase: SupabaseClient,
  tenantId: string,
  filters: DashboardFilters,
): Promise<DashboardCloseCycleStatsRow> {
  const rows = await callRpc<DashboardCloseCycleStatsRow[]>(
    supabase,
    "dashboard_close_cycle_stats",
    dashboardRpcParams(tenantId, filters),
  );
  return rows?.[0] ?? EMPTY_CLOSE_CYCLE;
}
