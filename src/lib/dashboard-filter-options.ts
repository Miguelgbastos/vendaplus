import {
  buildDimensionOptions,
  buildOwnerOptions,
  NULL_FILTER_VALUE,
  stageFilterOptions,
  type DashboardFilters,
} from "@/lib/dashboard-filters";

export type DashboardFilterOption = { value: string; label: string };

export type DashboardFilterOptions = {
  campaigns: DashboardFilterOption[];
  sources: DashboardFilterOption[];
  media: DashboardFilterOption[];
  owners: DashboardFilterOption[];
  stages: DashboardFilterOption[];
};

export type OptionLeadRow = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  responsible_user_id: string | null;
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

/** Build filter dropdowns from leads already loaded for the current range. */
export function buildDashboardFilterOptions(
  rows: OptionLeadRow[],
  selected?: Pick<
    DashboardFilters,
    "campaign" | "source" | "medium" | "owner"
  >,
): DashboardFilterOptions {
  const campaigns = ensureSelectedOption(
    buildDimensionOptions(
      rows.map((row) => row.utm_campaign),
      "Sem campanha",
    ),
    selected?.campaign,
    (value) => value.replace(/_/g, " "),
  );
  const sources = ensureSelectedOption(
    buildDimensionOptions(
      rows.map((row) => row.utm_source),
      "Sem origem",
    ),
    selected?.source,
    (value) => value.replace(/_/g, " "),
  );
  const media = ensureSelectedOption(
    buildDimensionOptions(
      rows.map((row) => row.utm_medium),
      "Sem mídia",
    ),
    selected?.medium,
    (value) => value.replace(/_/g, " "),
  );
  const owners = ensureSelectedOption(
    buildOwnerOptions(rows.map((row) => row.responsible_user_id)),
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
