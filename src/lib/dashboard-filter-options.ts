import { createClient } from "@/lib/supabase/server";
import {
  buildDimensionOptions,
  buildOwnerOptions,
  stageFilterOptions,
} from "@/lib/dashboard-filters";
import { fetchAllTenantRows } from "@/lib/dashboard-query";

export type DashboardFilterOption = { value: string; label: string };

export type DashboardFilterOptions = {
  campaigns: DashboardFilterOption[];
  sources: DashboardFilterOption[];
  media: DashboardFilterOption[];
  owners: DashboardFilterOption[];
  stages: DashboardFilterOption[];
};

type OptionLeadRow = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  responsible_user_id: string | null;
};

export async function loadDashboardFilterOptions(
  tenantId: string,
): Promise<DashboardFilterOptions> {
  const supabase = await createClient();
  const rows = await fetchAllTenantRows<OptionLeadRow>(
    supabase,
    "leads",
    tenantId,
    "utm_source, utm_medium, utm_campaign, responsible_user_id",
  );

  return {
    campaigns: buildDimensionOptions(
      rows.map((row) => row.utm_campaign),
      "Sem campanha",
    ),
    sources: buildDimensionOptions(
      rows.map((row) => row.utm_source),
      "Sem origem",
    ),
    media: buildDimensionOptions(
      rows.map((row) => row.utm_medium),
      "Sem mídia",
    ),
    owners: buildOwnerOptions(rows.map((row) => row.responsible_user_id)),
    stages: stageFilterOptions(),
  };
}
