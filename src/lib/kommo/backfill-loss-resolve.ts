import {
  isActiveMilestone,
  kommoUnixToIso,
  mapQualification,
  qualificationFromKommoStatusId,
  KOMMO_STATUS_LOST,
} from "./normalize.ts";
import type { QualificationStage } from "../../types/database.ts";

export type KommoLeadStatusEventLike = {
  id: string;
  type: string;
  entity_id: number;
  created_at: number;
  value_before?: Array<{ lead_status?: { id?: number; pipeline_id?: number } }>;
  value_after?: Array<{ lead_status?: { id?: number; pipeline_id?: number } }>;
};

export type CommercialPriorStage = "sql" | "oportunidade" | "negociacao";

const COMMERCIAL_PRIOR: CommercialPriorStage[] = [
  "negociacao",
  "oportunidade",
  "sql",
];

export function isCommercialPriorStage(
  value: string | null | undefined,
): value is CommercialPriorStage {
  return value === "sql" || value === "oportunidade" || value === "negociacao";
}

/** Ensure backfill row wins dashboard DISTINCT ON (... ORDER BY changed_at DESC). */
export function backfillChangedAtAfterLastPerda(
  preferredChangedAt: string | null | undefined,
  lastPerdaChangedAt: string | null | undefined,
): string {
  const preferred = preferredChangedAt ?? new Date().toISOString();
  if (!lastPerdaChangedAt) return preferred;
  const lastMs = Date.parse(lastPerdaChangedAt);
  const preferredMs = Date.parse(preferred);
  if (!Number.isFinite(lastMs)) return preferred;
  if (!Number.isFinite(preferredMs) || preferredMs <= lastMs) {
    return new Date(lastMs + 1000).toISOString();
  }
  return preferred;
}

/** Marker changed_at stays behind the last perda so the chart is unchanged. */
export function unresolvedMarkerChangedAt(
  lastPerdaChangedAt: string | null | undefined,
  fallbackChangedAt: string | null | undefined,
): string {
  if (lastPerdaChangedAt) {
    const lastMs = Date.parse(lastPerdaChangedAt);
    if (Number.isFinite(lastMs)) {
      return new Date(lastMs - 1000).toISOString();
    }
  }
  return fallbackChangedAt ?? new Date().toISOString();
}

/** Highest commercial milestone present on the lead card / custom fields. */
export function commercialStageFromMilestones(
  customFields: Record<string, unknown> | null | undefined,
): CommercialPriorStage | null {
  const bag = customFields ?? {};
  for (const stage of COMMERCIAL_PRIOR) {
    const aliases =
      stage === "negociacao"
        ? [stage, "Negociação", "negociacao", "NEGOCIACAO"]
        : [stage, stage.toUpperCase()];
    for (const alias of aliases) {
      if (isActiveMilestone(bag[alias]) || isActiveMilestone(bag[stage])) {
        return stage;
      }
    }
  }
  return null;
}

function statusIdFromEventSide(
  side:
    | KommoLeadStatusEventLike["value_before"]
    | KommoLeadStatusEventLike["value_after"],
): string | null {
  if (!Array.isArray(side) || side.length === 0) return null;
  const id = side[0]?.lead_status?.id;
  return id == null ? null : String(id);
}

export function resolveQualificationFromStatusId(
  statusId: string | null,
  statusNames: Readonly<Record<string, string>> = {},
): QualificationStage | null {
  if (!statusId) return null;
  return (
    qualificationFromKommoStatusId(statusId) ??
    mapQualification(statusNames[statusId] ?? null)
  );
}

/**
 * Find the last transition *into* perda and return the previous commercial stage.
 */
export function previousCommercialStageFromEvents(
  events: KommoLeadStatusEventLike[],
  statusNames: Readonly<Record<string, string>> = {},
): { stage: CommercialPriorStage; changedAt: string | null } | null {
  const ordered = [...events].sort((a, b) => b.created_at - a.created_at);
  for (const event of ordered) {
    const afterId = statusIdFromEventSide(event.value_after);
    const beforeId = statusIdFromEventSide(event.value_before);
    const afterQual = resolveQualificationFromStatusId(afterId, statusNames);
    if (afterQual !== "perda" && afterId !== KOMMO_STATUS_LOST) continue;

    const beforeQual = resolveQualificationFromStatusId(beforeId, statusNames);
    if (isCommercialPriorStage(beforeQual)) {
      return {
        stage: beforeQual,
        changedAt: kommoUnixToIso(event.created_at),
      };
    }
  }
  return null;
}
