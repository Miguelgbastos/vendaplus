import type { SupabaseClient } from "@supabase/supabase-js";
import {
  firstSeenRangeBounds,
  NULL_FILTER_VALUE,
  type DashboardFilters,
} from "@/lib/dashboard-filters";

const PAGE_SIZE = 1000;

type FilterQuery = {
  // Minimal surface used by the loaders; avoids coupling to generated DB types.
  eq: (column: string, value: string) => FilterQuery;
  gte: (column: string, value: string) => FilterQuery;
  lt: (column: string, value: string) => FilterQuery;
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};

function applySqlDimensionFilter(
  query: FilterQuery,
  column: string,
  value: string | undefined,
): FilterQuery {
  if (!value || value === NULL_FILTER_VALUE) return query;
  return query.eq(column, value);
}

export function applyDashboardSqlFilters(
  query: FilterQuery,
  filters: DashboardFilters,
): FilterQuery {
  const { gte, lt } = firstSeenRangeBounds(filters.from, filters.to);
  let next = query.gte("first_seen_at", gte).lt("first_seen_at", lt);
  next = applySqlDimensionFilter(next, "utm_campaign", filters.campaign);
  next = applySqlDimensionFilter(next, "utm_source", filters.source);
  next = applySqlDimensionFilter(next, "utm_medium", filters.medium);
  next = applySqlDimensionFilter(next, "responsible_user_id", filters.owner);
  return next;
}

export async function fetchAllFilteredLeads<T>(
  supabase: SupabaseClient,
  tenantId: string,
  filters: DashboardFilters,
  select: string,
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;

  for (;;) {
    let query = supabase
      .from("leads")
      .select(select)
      .eq("tenant_id", tenantId) as unknown as FilterQuery;
    query = applyDashboardSqlFilters(query, filters);

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

export async function fetchAllTenantRows<T>(
  supabase: SupabaseClient,
  table: "qualification_history" | "leads",
  tenantId: string,
  select: string,
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .eq("tenant_id", tenantId)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}
