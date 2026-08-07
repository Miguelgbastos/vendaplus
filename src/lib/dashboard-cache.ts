import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DashboardFilters } from "@/lib/dashboard-filters";

export const DASHBOARD_CACHE_REVALIDATE_SECONDS = 60;

/** Tag invalidada pelo worker Kommo após upsert de leads do tenant. */
export function dashboardCacheTag(tenantId: string): string {
  return `dashboard:${tenantId}`;
}

export function dashboardFilterCacheKey(filters: DashboardFilters): string {
  return [
    filters.from,
    filters.to,
    filters.campaign ?? "",
    filters.source ?? "",
    filters.medium ?? "",
    filters.owner ?? "",
    filters.stage ?? "",
  ].join("|");
}

/**
 * Cache curto (60s) por tenant+filtros em volta das RPCs de agregação.
 *
 * A autorização acontece FORA do cache (getActiveTenant nas páginas valida a
 * membership antes de chamar os loaders). Dentro da função cacheada não é
 * permitido ler cookies/sessão, então usamos o client admin — o resultado é
 * tenant-scoped e compartilhado entre usuários do mesmo tenant, o que é o
 * comportamento desejado.
 */
export function cachedDashboardQuery<T>(
  name: string,
  tenantId: string,
  filterKey: string,
  loader: (supabase: SupabaseClient) => Promise<T>,
): Promise<T> {
  return unstable_cache(
    async () => loader(createAdminClient()),
    ["dashboard", name, tenantId, filterKey],
    {
      revalidate: DASHBOARD_CACHE_REVALIDATE_SECONDS,
      tags: [dashboardCacheTag(tenantId)],
    },
  )();
}
