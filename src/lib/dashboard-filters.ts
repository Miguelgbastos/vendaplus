import type { QualificationStage } from "../types/database";
import { ownerLabel } from "./kommo/user-directory.ts";

export const NULL_FILTER_VALUE = "__none__";
export const MAX_RANGE_DAYS = 90;
export const DEFAULT_RANGE_DAYS = 30;
export const FILTER_TIMEZONE = "America/Sao_Paulo";

const QUALIFICATION_MILESTONES: QualificationStage[] = [
  "mql",
  "sal",
  "sql",
  "oportunidade",
  "negociacao",
  "venda",
  "perda",
];

function isActiveMilestone(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  return ["1", "true", "sim", "yes", "ativo", "active"].includes(normalized);
}

function milestonesForQualification(
  qualification: QualificationStage | null,
): QualificationStage[] {
  if (!qualification) return [];
  if (qualification === "perda") return ["perda"];
  const positiveStages = QUALIFICATION_MILESTONES.filter(
    (stage) => stage !== "perda",
  );
  const index = positiveStages.indexOf(qualification);
  return index >= 0 ? positiveStages.slice(0, index + 1) : [];
}

export type DashboardFilters = {
  from: string;
  to: string;
  campaign?: string;
  source?: string;
  medium?: string;
  owner?: string;
  stage?: QualificationStage;
};

export type ParsedDashboardFilters = {
  filters: DashboardFilters;
  clamped: boolean;
};

export type FilterableLead = {
  qualification: QualificationStage | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  responsible_user_id: string | null;
  custom_fields: Record<string, unknown> | null;
  first_seen_at: string;
};

export const STAGE_LABELS: Record<QualificationStage, string> = {
  mql: "MQL",
  sal: "SAL",
  sql: "SQL",
  oportunidade: "Oportunidade",
  negociacao: "Negociação",
  venda: "Venda",
  perda: "Perda",
};

const STAGE_SET = new Set<string>(QUALIFICATION_MILESTONES);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

export function formatFilterDimensionLabel(value: string): string {
  return value.replace(/_/g, " ");
}

export function ymdInSaoPaulo(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FILTER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function todayInSaoPaulo(now = new Date()): string {
  return ymdInSaoPaulo(now);
}

export function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function daysBetweenInclusive(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function defaultDateRange(now = new Date()): { from: string; to: string } {
  const to = todayInSaoPaulo(now);
  const from = addDaysYmd(to, -(DEFAULT_RANGE_DAYS - 1));
  return { from, to };
}

export function saoPauloDayStartIso(ymd: string): string {
  return `${ymd}T00:00:00-03:00`;
}

export function firstSeenRangeBounds(from: string, to: string): {
  gte: string;
  lt: string;
} {
  return {
    gte: saoPauloDayStartIso(from),
    lt: saoPauloDayStartIso(addDaysYmd(to, 1)),
  };
}

function parseDateParam(value: string | null | undefined): string | null {
  if (!value || !DATE_RE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return value;
}

function optionalParam(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseStage(
  value: string | null | undefined,
): QualificationStage | undefined {
  const trimmed = optionalParam(value);
  if (!trimmed || !STAGE_SET.has(trimmed)) return undefined;
  return trimmed as QualificationStage;
}

export function parseDashboardFilters(
  params: Record<string, string | string[] | undefined> | URLSearchParams,
  now = new Date(),
): ParsedDashboardFilters {
  const get = (key: string): string | undefined => {
    if (params instanceof URLSearchParams) {
      return params.get(key) ?? undefined;
    }
    const raw = params[key];
    if (Array.isArray(raw)) return raw[0];
    return raw;
  };

  const defaults = defaultDateRange(now);
  let from = parseDateParam(get("from")) ?? defaults.from;
  let to = parseDateParam(get("to")) ?? defaults.to;

  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }

  let clamped = false;
  if (daysBetweenInclusive(from, to) > MAX_RANGE_DAYS) {
    from = addDaysYmd(to, -(MAX_RANGE_DAYS - 1));
    clamped = true;
  }

  const filters: DashboardFilters = {
    from,
    to,
    campaign: optionalParam(get("campaign")),
    source: optionalParam(get("source")),
    medium: optionalParam(get("medium")),
    owner: optionalParam(get("owner")),
    stage: parseStage(get("stage")),
  };

  return { filters, clamped };
}

export function serializeDashboardFilters(
  filters: DashboardFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("from", filters.from);
  params.set("to", filters.to);
  if (filters.campaign) params.set("campaign", filters.campaign);
  if (filters.source) params.set("source", filters.source);
  if (filters.medium) params.set("medium", filters.medium);
  if (filters.owner) params.set("owner", filters.owner);
  if (filters.stage) params.set("stage", filters.stage);
  return params;
}

export function leadReachedStages(lead: {
  qualification: QualificationStage | null;
  custom_fields: Record<string, unknown> | null;
}): Set<QualificationStage> {
  const reached = new Set(milestonesForQualification(lead.qualification));
  const custom = lead.custom_fields ?? {};
  for (const stage of QUALIFICATION_MILESTONES) {
    if (
      isActiveMilestone(custom[stage]) ||
      isActiveMilestone(custom[stage.toUpperCase()])
    ) {
      reached.add(stage);
    }
  }
  return reached;
}

function matchesNullableDimension(
  columnValue: string | null | undefined,
  filterValue: string | undefined,
): boolean {
  if (!filterValue) return true;
  if (filterValue === NULL_FILTER_VALUE) return isBlank(columnValue);
  return (columnValue ?? "").trim() === filterValue;
}

export function applyLeadFilters<T extends FilterableLead>(
  leads: T[],
  filters: DashboardFilters,
): T[] {
  const { gte, lt } = firstSeenRangeBounds(filters.from, filters.to);
  const gteMs = Date.parse(gte);
  const ltMs = Date.parse(lt);

  return leads.filter((lead) => {
    const seen = Date.parse(lead.first_seen_at);
    if (!Number.isNaN(seen) && (seen < gteMs || seen >= ltMs)) return false;
    if (!matchesNullableDimension(lead.utm_campaign, filters.campaign)) {
      return false;
    }
    if (!matchesNullableDimension(lead.utm_source, filters.source)) {
      return false;
    }
    if (!matchesNullableDimension(lead.utm_medium, filters.medium)) {
      return false;
    }
    if (!matchesNullableDimension(lead.responsible_user_id, filters.owner)) {
      return false;
    }
    if (filters.stage && !leadReachedStages(lead).has(filters.stage)) {
      return false;
    }
    return true;
  });
}

export function buildDimensionOptions(
  values: Array<string | null | undefined>,
  noneLabel: string,
): Array<{ value: string; label: string }> {
  const unique = new Map<string, string>();
  let hasNone = false;

  for (const value of values) {
    if (isBlank(value)) {
      hasNone = true;
      continue;
    }
    const raw = value!.trim();
    if (!unique.has(raw)) {
      unique.set(raw, formatFilterDimensionLabel(raw));
    }
  }

  const options = [...unique.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) =>
      a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }),
    );

  if (hasNone) {
    options.unshift({ value: NULL_FILTER_VALUE, label: noneLabel });
  }
  return options;
}

export function buildOwnerOptions(
  values: Array<string | null | undefined>,
  names: Readonly<Record<string, string>> = {},
): Array<{ value: string; label: string }> {
  const unique = new Map<string, string>();
  let hasNone = false;

  for (const value of values) {
    if (isBlank(value)) {
      hasNone = true;
      continue;
    }
    const raw = value!.trim();
    if (!unique.has(raw)) unique.set(raw, ownerLabel(raw, names));
  }

  const options = [...unique.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) =>
      a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }),
    );

  if (hasNone) {
    options.unshift({ value: NULL_FILTER_VALUE, label: "Sem responsável" });
  }
  return options;
}

export function stageFilterOptions(): Array<{ value: string; label: string }> {
  return QUALIFICATION_MILESTONES.map((stage) => ({
    value: stage,
    label: STAGE_LABELS[stage],
  }));
}
