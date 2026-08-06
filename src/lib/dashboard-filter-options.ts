import { cachedDashboardQuery } from "@/lib/dashboard-cache";
import {
  buildDimensionOptions,
  buildOwnerOptions,
  NULL_FILTER_VALUE,
  stageFilterOptions,
  type DashboardFilters,
} from "@/lib/dashboard-filters";
import { fetchDashboardFilterOptionRows } from "@/lib/dashboard-rpc";
import type { DashboardFilterOptionRow } from "@/types/database";

export type DashboardFilterOption = { value: string; label: string };

export type DashboardFilterOptions = {
  campaigns: DashboardFilterOption[];
  sources: DashboardFilterOption[];
  media: DashboardFilterOption[];
  owners: DashboardFilterOption[];
  stages: DashboardFilterOption[];
};

function ensureSelectedOption(
  options: DashboardFilterOption[],
  selected: string | undefined,
  labelFor: (value: string) => string,
): DashboardFilterOption[] {
  if (!selected || selected === NULL_FILTER_VALUE) return options;
  if (options.some((option) => option.value === selected)) return options;
  // Append without re-sorting so "Sem …" stays at the top.
  return [...options, { value: selected, label: labelFor(selected) }];
}

/** Build filter dropdowns from distinct dimension values (null = blank present). */
export function buildDashboardFilterOptions(
  rows: DashboardFilterOptionRow[],
  selected?: Pick<
    DashboardFilters,
    "campaign" | "source" | "medium" | "owner"
  >,
): DashboardFilterOptions {
  const valuesFor = (dimension: DashboardFilterOptionRow["dimension"]) =>
    rows
      .filter((row) => row.dimension === dimension)
      .map((row) => row.value);

  const campaigns = ensureSelectedOption(
    buildDimensionOptions(valuesFor("campaign"), "Sem campanha"),
    selected?.campaign,
    (value) => value.replace(/_/g, " "),
  );
  const sources = ensureSelectedOption(
    buildDimensionOptions(valuesFor("source"), "Sem origem"),
    selected?.source,
    (value) => value.replace(/_/g, " "),
  );
  const media = ensureSelectedOption(
    buildDimensionOptions(valuesFor("medium"), "Sem mídia"),
    selected?.medium,
    (value) => value.replace(/_/g, " "),
  );
  const owners = ensureSelectedOption(
    buildOwnerOptions(valuesFor("owner")),
    selected?.owner,
    (value) => (/^\d+$/.test(value) ? `#${value}` : value),
  );

  return {
    campaigns,
    sources,
    media,
    owners,
    stages: stageFilterOptions(),
  };
}

/**
 * Options for the active date range, ignoring campaign/source/medium/owner
 * so the user can switch dimensions without losing other period choices.
 */
export async function loadDashboardFilterOptions(
  tenantId: string,
  filters: DashboardFilters,
): Promise<DashboardFilterOptions> {
  // Só o período define os valores distintos; a seleção ativa entra depois.
  const rows = await cachedDashboardQuery(
    "filter-options",
    tenantId,
    `${filters.from}|${filters.to}`,
    (supabase) => fetchDashboardFilterOptionRows(supabase, tenantId, filters),
  );
  return buildDashboardFilterOptions(rows, filters);
}
