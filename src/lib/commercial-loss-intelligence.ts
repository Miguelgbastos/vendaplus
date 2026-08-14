export const LOSS_PREVIOUS_STAGES = [
  "sql",
  "oportunidade",
  "negociacao",
  "sem_historico",
] as const;

export type LossPreviousStageKey = (typeof LOSS_PREVIOUS_STAGES)[number];

export const STAGNANT_BUCKETS = ["3", "7", "15", "30+"] as const;
export type StagnantBucket = (typeof STAGNANT_BUCKETS)[number];

export const LOSS_PREVIOUS_STAGE_LABELS: Record<LossPreviousStageKey, string> = {
  sql: "SQL",
  oportunidade: "Oportunidade",
  negociacao: "Negociação",
  sem_historico: "Sem histórico",
};

export const STAGNANT_BUCKET_LABELS: Record<StagnantBucket, string> = {
  "3": "3–6 dias",
  "7": "7–14 dias",
  "15": "15–29 dias",
  "30+": "30+ dias",
};

const COMMERCIAL_PRIOR = new Set(["sql", "oportunidade", "negociacao"]);

/** Same contract as ownerLabel — kept local so node:test can load this module. */
function labelOwner(
  ownerId: string,
  names: Readonly<Record<string, string>> = {},
): string {
  const name = names[ownerId]?.trim();
  if (name) return name;
  return /^\d+$/.test(ownerId) ? `#${ownerId}` : ownerId;
}

/** Map history from_qualification → chart bucket without inventing missing stages. */
export function categorizePreviousStage(
  fromQualification: string | null | undefined,
): LossPreviousStageKey {
  if (fromQualification && COMMERCIAL_PRIOR.has(fromQualification)) {
    return fromQualification as LossPreviousStageKey;
  }
  return "sem_historico";
}

/**
 * Keep only the latest loss event per lead (by changedAt), then classify.
 * Used for unit coverage of the SQL DISTINCT ON semantics.
 */
export function dedupeLastLossesByLead<
  T extends { leadId: string; changedAt: string; fromQualification: string | null },
>(events: T[]): Array<T & { previousStage: LossPreviousStageKey }> {
  const latest = new Map<string, T>();
  for (const event of events) {
    const current = latest.get(event.leadId);
    if (!current || event.changedAt > current.changedAt) {
      latest.set(event.leadId, event);
    }
  }
  return [...latest.values()].map((event) => ({
    ...event,
    previousStage: categorizePreviousStage(event.fromQualification),
  }));
}

export type LossPopulationLead = {
  leadId: string;
  currentQualification: string;
  closedAt: string | null;
  fromQualification: string | null;
  hasHistory: boolean;
  previousStage: LossPreviousStageKey;
};

/**
 * Mirrors dashboard_loss_events_deduped:
 * 1) history to_qualification=perda with changed_at in period (dedupe last)
 * 2) fallback currently perda + closed_at in period without history event → sem_historico
 * History path does NOT require current qualification=perda (covers recovery/sale).
 */
export function buildLossPopulation(input: {
  periodFrom: string;
  periodTo: string;
  historyEvents: Array<{
    leadId: string;
    toQualification: string;
    fromQualification: string | null;
    changedAt: string;
    inferred?: boolean;
  }>;
  leads: Array<{
    leadId: string;
    qualification: string;
    closedAt: string | null;
  }>;
}): LossPopulationLead[] {
  const { periodFrom, periodTo } = input;
  const inPeriod = (iso: string) => iso >= periodFrom && iso < periodTo;

  const historyLosses = input.historyEvents.filter(
    (event) =>
      event.toQualification === "perda" &&
      !event.inferred &&
      inPeriod(event.changedAt),
  );
  const lastByLead = dedupeLastLossesByLead(
    historyLosses.map((event) => ({
      leadId: event.leadId,
      changedAt: event.changedAt,
      fromQualification: event.fromQualification,
    })),
  );
  const historyLeadIds = new Set(lastByLead.map((row) => row.leadId));
  const leadById = new Map(input.leads.map((lead) => [lead.leadId, lead]));

  const population: LossPopulationLead[] = [];
  for (const row of lastByLead) {
    const lead = leadById.get(row.leadId);
    if (!lead) continue;
    population.push({
      leadId: row.leadId,
      currentQualification: lead.qualification,
      closedAt: lead.closedAt,
      fromQualification: row.fromQualification,
      hasHistory: true,
      previousStage: row.previousStage,
    });
  }

  for (const lead of input.leads) {
    if (lead.qualification !== "perda") continue;
    if (!lead.closedAt || !inPeriod(lead.closedAt)) continue;
    if (historyLeadIds.has(lead.leadId)) continue;
    population.push({
      leadId: lead.leadId,
      currentQualification: lead.qualification,
      closedAt: lead.closedAt,
      fromQualification: null,
      hasHistory: false,
      previousStage: "sem_historico",
    });
  }

  return population;
}

export function previousStageBars(
  rows: Array<{ previous_stage: string; total: number }>,
): Array<{ stage: LossPreviousStageKey; name: string; value: number; percent: number }> {
  const totals = new Map<LossPreviousStageKey, number>(
    LOSS_PREVIOUS_STAGES.map((stage) => [stage, 0]),
  );
  for (const row of rows) {
    const stage =
      row.previous_stage === "sem_historico"
        ? "sem_historico"
        : categorizePreviousStage(row.previous_stage);
    totals.set(stage, (totals.get(stage) ?? 0) + Number(row.total || 0));
  }
  const grand = [...totals.values()].reduce((sum, n) => sum + n, 0);
  return LOSS_PREVIOUS_STAGES.map((stage) => {
    const value = totals.get(stage) ?? 0;
    return {
      stage,
      name: LOSS_PREVIOUS_STAGE_LABELS[stage],
      value,
      percent: grand > 0 ? Math.round((value / grand) * 1000) / 10 : 0,
    };
  });
}

export type LossMatrixCell = {
  previousStage: LossPreviousStageKey;
  reason: string;
  total: number;
};

/** Collapse to top N reasons (+ Sem motivo always kept); remainder → Outros. */
export function limitLossMatrixReasons(
  cells: Array<{ previous_stage: string; reason: string; total: number }>,
  limit = 8,
): {
  reasons: string[];
  stages: LossPreviousStageKey[];
  cells: LossMatrixCell[];
  matrix: Record<string, Record<string, number>>;
} {
  const normalized: LossMatrixCell[] = cells.map((cell) => ({
    previousStage:
      cell.previous_stage === "sem_historico"
        ? "sem_historico"
        : categorizePreviousStage(cell.previous_stage),
    reason: cell.reason?.trim() ? cell.reason.trim() : "Sem motivo",
    total: Number(cell.total || 0),
  }));

  const reasonTotals = new Map<string, number>();
  for (const cell of normalized) {
    reasonTotals.set(cell.reason, (reasonTotals.get(cell.reason) ?? 0) + cell.total);
  }

  const ranked = [...reasonTotals.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0], "pt-BR");
  });

  const topOthers = ranked
    .filter(([reason]) => reason !== "Sem motivo")
    .slice(0, limit)
    .map(([reason]) => reason);
  const allowed = new Set<string>(["Sem motivo", ...topOthers]);

  const collapsed = new Map<string, number>();
  for (const cell of normalized) {
    const reason = allowed.has(cell.reason) ? cell.reason : "Outros";
    const key = `${cell.previousStage}||${reason}`;
    collapsed.set(key, (collapsed.get(key) ?? 0) + cell.total);
  }

  const stages = [...LOSS_PREVIOUS_STAGES];
  const reasonOrder: string[] = [];
  for (const reason of [...topOthers, "Sem motivo", "Outros"]) {
    if (
      [...collapsed.keys()].some((key) => key.endsWith(`||${reason}`)) &&
      !reasonOrder.includes(reason)
    ) {
      reasonOrder.push(reason);
    }
  }

  const cellsOut: LossMatrixCell[] = [];
  const matrix: Record<string, Record<string, number>> = {};
  for (const stage of stages) {
    matrix[stage] = {};
    for (const reason of reasonOrder) {
      const total = collapsed.get(`${stage}||${reason}`) ?? 0;
      matrix[stage][reason] = total;
      if (total > 0) {
        cellsOut.push({ previousStage: stage, reason, total });
      }
    }
  }

  return { reasons: reasonOrder, stages, cells: cellsOut, matrix };
}

export type StagnantOpenRow = {
  ownerId: string;
  ownerName: string;
  stage: string;
  stageLabel: string;
  bucket3: number;
  bucket7: number;
  bucket15: number;
  bucket30: number;
  total: number;
};

const STAGE_LABELS: Record<string, string> = {
  sql: "SQL",
  oportunidade: "Oportunidade",
  negociacao: "Negociação",
};

/** Priority table: one row per owner×stage, sorted by 30+ then 15/7/3. */
export function buildStagnantPriorityTable(
  rows: Array<{ owner_id: string; stage: string; bucket: string; total: number }>,
  ownerNames: Readonly<Record<string, string>> = {},
): StagnantOpenRow[] {
  const map = new Map<string, StagnantOpenRow>();
  for (const row of rows) {
    const ownerId = row.owner_id?.trim() ?? "";
    const key = `${ownerId}||${row.stage}`;
    const current = map.get(key) ?? {
      ownerId,
      ownerName: ownerId ? labelOwner(ownerId, ownerNames) : "Sem responsável",
      stage: row.stage,
      stageLabel: STAGE_LABELS[row.stage] ?? row.stage,
      bucket3: 0,
      bucket7: 0,
      bucket15: 0,
      bucket30: 0,
      total: 0,
    };
    const total = Number(row.total || 0);
    if (row.bucket === "3") current.bucket3 += total;
    else if (row.bucket === "7") current.bucket7 += total;
    else if (row.bucket === "15") current.bucket15 += total;
    else if (row.bucket === "30+") current.bucket30 += total;
    current.total =
      current.bucket3 + current.bucket7 + current.bucket15 + current.bucket30;
    map.set(key, current);
  }

  return [...map.values()].sort((a, b) => {
    if (b.bucket30 !== a.bucket30) return b.bucket30 - a.bucket30;
    if (b.bucket15 !== a.bucket15) return b.bucket15 - a.bucket15;
    if (b.bucket7 !== a.bucket7) return b.bucket7 - a.bucket7;
    if (b.bucket3 !== a.bucket3) return b.bucket3 - a.bucket3;
    return a.ownerName.localeCompare(b.ownerName, "pt-BR");
  });
}

export type OwnerConversionRow = {
  ownerId: string;
  name: string;
  sql: number;
  oportunidade: number;
  negociacao: number;
  venda: number;
  sqlToVenda: number;
};

export function buildOwnerConversion(
  rows: Array<{
    name: string;
    sql: number;
    oportunidade: number;
    negociacao: number;
    venda: number;
  }>,
  ownerNames: Readonly<Record<string, string>> = {},
  fallback = "Sem responsável",
): OwnerConversionRow[] {
  return rows
    .map((row) => {
      const ownerId = row.name === fallback ? "" : row.name;
      const sql = Number(row.sql || 0);
      const venda = Number(row.venda || 0);
      return {
        ownerId,
        name: ownerId ? labelOwner(ownerId, ownerNames) : fallback,
        sql,
        oportunidade: Number(row.oportunidade || 0),
        negociacao: Number(row.negociacao || 0),
        venda,
        sqlToVenda: sql > 0 ? Math.round((venda / sql) * 1000) / 10 : 0,
      };
    })
    .filter((row) => row.sql > 0)
    .sort((a, b) => {
      if (b.venda !== a.venda) return b.venda - a.venda;
      return b.sql - a.sql;
    });
}

export type CloseCycleStats = {
  medianDaysToVenda: number | null;
  vendaSampleSize: number;
  medianDaysToPerda: number | null;
  perdaSampleSize: number;
  recoveredToVenda: number;
  hasReliableHistory: boolean;
};

/** Mark medians unavailable when sample size is zero (no reliable history). */
export function normalizeCloseCycleStats(row: {
  median_days_to_venda: number | string | null;
  venda_sample_size: number;
  median_days_to_perda: number | string | null;
  perda_sample_size: number;
  recovered_to_venda: number;
} | null): CloseCycleStats {
  if (!row) {
    return {
      medianDaysToVenda: null,
      vendaSampleSize: 0,
      medianDaysToPerda: null,
      perdaSampleSize: 0,
      recoveredToVenda: 0,
      hasReliableHistory: false,
    };
  }
  const vendaSampleSize = Number(row.venda_sample_size || 0);
  const perdaSampleSize = Number(row.perda_sample_size || 0);
  return {
    medianDaysToVenda:
      vendaSampleSize > 0 && row.median_days_to_venda != null
        ? Number(row.median_days_to_venda)
        : null,
    vendaSampleSize,
    medianDaysToPerda:
      perdaSampleSize > 0 && row.median_days_to_perda != null
        ? Number(row.median_days_to_perda)
        : null,
    perdaSampleSize,
    recoveredToVenda: Number(row.recovered_to_venda || 0),
    hasReliableHistory: vendaSampleSize > 0 || perdaSampleSize > 0,
  };
}

/** Recovered = had perda in history, then later reached venda. */
export function isRecoveredLoss(events: Array<{ to: string; at: string }>): boolean {
  const perdaAt = events
    .filter((e) => e.to === "perda")
    .map((e) => e.at)
    .sort()[0];
  if (!perdaAt) return false;
  return events.some((e) => e.to === "venda" && e.at > perdaAt);
}
