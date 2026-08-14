import { cachedDashboardQuery } from "@/lib/dashboard-cache";
import {
  buildDimensionOptions,
  buildOwnerOptions,
  NULL_FILTER_VALUE,
  stageFilterOptions,
  type DashboardFilters,
} from "@/lib/dashboard-filters";
import { fetchDashboardFilterOptionRows } from "@/lib/dashboard-rpc";
import { ownerLabel } from "@/lib/kommo/user-directory";
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
  ownerNames: Readonly<Record<string, string>> = {},
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
    buildOwnerOptions(valuesFor("owner"), ownerNames),
    selected?.owner,
    (value) => ownerLabel(value, ownerNames),
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
  const { rows, ownerNames } = await cachedDashboardQuery(
    // Versão bumpada: o payload passou de DashboardFilterOptionRow[] para
    // { rows, ownerNames }; entradas antigas quebrariam o destructuring.
    "filter-options-v2",
    tenantId,
    `${filters.from}|${filters.to}`,
    async (supabase) => {
      const rows = await fetchDashboardFilterOptionRows(supabase, tenantId, filters);
      const ownerIds = [...new Set(
        rows
          .filter((row) => row.dimension === "owner" && row.value)
          .map((row) => row.value as string),
      )];

      if (ownerIds.length === 0) return { rows, ownerNames: {} };

      // Compatibility fallback: a code deploy before the migration must keep
      // the dashboard usable and show #ID until the directory table exists.
      const { data, error } = await supabase
        .from("kommo_users")
        .select("kommo_user_id, name")
        .eq("tenant_id", tenantId)
        .in("kommo_user_id", ownerIds);
      if (error) return { rows, ownerNames: {} };

      return {
        rows,
        ownerNames: Object.fromEntries(
          (data ?? []).map((user) => [String(user.kommo_user_id), String(user.name)]),
        ),
      };
    },
  );
  return buildDashboardFilterOptions(rows, filters, ownerNames);
}
