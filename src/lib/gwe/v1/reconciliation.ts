import type { CrmLeadSnapshot, GweStage } from "./types.ts";

export type ReconciliationOutcome = "applied" | "noop" | "stale_ignored";

export type ReconciliationState = {
  leadExists: boolean;
  currentStage: GweStage | null;
  milestones: Partial<Record<GweStage, true>>;
  pipelineId: string | null;
  stageId: string | null;
  stageName: string | null;
  lastSourceEventAt: Date | null;
  lastSourceSequence: number | null;
};

export type ReconciliationResult = {
  outcome: ReconciliationOutcome;
  leadPatch: Partial<ReconciliationState>;
  newMilestones: GweStage[];
  stageChanged: boolean;
  ordering: {
    lastSourceEventAt: Date;
    lastSourceSequence: number | null;
  };
};

function isStale(
  current: ReconciliationState,
  incoming: CrmLeadSnapshot,
): boolean {
  if (incoming.sourceEvent.sequence !== null && current.lastSourceSequence !== null) {
    return incoming.sourceEvent.sequence <= current.lastSourceSequence;
  }
  if (incoming.sourceEvent.sequence === null && current.lastSourceEventAt !== null) {
    return incoming.sourceEvent.occurredAt <= current.lastSourceEventAt;
  }
  return false;
}

export function reconcileCrmLeadSnapshot(
  current: ReconciliationState,
  incoming: CrmLeadSnapshot,
): ReconciliationResult {
  const ordering = {
    lastSourceEventAt: incoming.sourceEvent.occurredAt,
    lastSourceSequence: incoming.sourceEvent.sequence,
  };

  if (current.leadExists && isStale(current, incoming)) {
    return {
      outcome: "stale_ignored",
      leadPatch: {},
      newMilestones: [],
      stageChanged: false,
      ordering: {
        lastSourceEventAt: current.lastSourceEventAt ?? incoming.sourceEvent.occurredAt,
        lastSourceSequence: current.lastSourceSequence,
      },
    };
  }

  const incomingMilestones = Object.keys(incoming.lifecycle.milestones) as GweStage[];
  const newMilestones = incomingMilestones.filter(
    (stage) => !current.milestones[stage],
  );
  const stageChanged =
    current.currentStage !== incoming.lifecycle.currentStage ||
    current.pipelineId !== incoming.crm.pipeline.id ||
    current.stageId !== incoming.crm.stage.id ||
    current.stageName !== incoming.crm.stage.name;

  const applied =
    !current.leadExists ||
    stageChanged ||
    newMilestones.length > 0;

  return {
    outcome: applied ? "applied" : "noop",
    leadPatch: applied
      ? {
          currentStage: incoming.lifecycle.currentStage,
          pipelineId: incoming.crm.pipeline.id,
          stageId: incoming.crm.stage.id,
          stageName: incoming.crm.stage.name,
        }
      : {},
    newMilestones,
    stageChanged,
    ordering,
  };
}
