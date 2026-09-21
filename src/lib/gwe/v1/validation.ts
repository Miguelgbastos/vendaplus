import type { z } from "zod";
import { gweV1Schema } from "./schema.ts";
import type { CrmLeadSnapshot, GweStage, GweV1Payload } from "./types.ts";

export type GweValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export class GweValidationError extends Error {
  readonly issues: GweValidationIssue[];

  constructor(issues: GweValidationIssue[]) {
    super("Payload GWE inválido.");
    this.name = "GweValidationError";
    this.issues = issues;
  }
}

export function validateGweSchema(input: unknown): GweV1Payload {
  const result = gweV1Schema.safeParse(input);
  if (!result.success) {
    throw new GweValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function validateGweSemantics(payload: GweV1Payload): void {
  const issues: GweValidationIssue[] = [];
  const current = payload.lifecycle.current_stage;

  if (current && payload.lifecycle.milestones[current] !== "1") {
    issues.push({
      path: `lifecycle.milestones.${current}`,
      code: "current_stage_milestone_mismatch",
      message: `current_stage=${current} exige o milestone correspondente como "1".`,
    });
  }

  if (
    payload.lifecycle.history_complete &&
    current === null &&
    Object.values(payload.lifecycle.milestones).some((value) => value === "1")
  ) {
    issues.push({
      path: "lifecycle.current_stage",
      code: "missing_current_stage",
      message: "Um snapshot com milestones atingidos deve informar o estágio atual.",
    });
  }

  if (issues.length > 0) throw new GweValidationError(issues);
}

export function validateGwePayload(input: unknown): GweV1Payload {
  const payload = validateGweSchema(input);
  validateGweSemantics(payload);
  return payload;
}

export function normalizeGwePayload(
  payload: GweV1Payload,
  context: {
    tenantId: string;
    connectionId: string;
    provider: string;
    observedAt?: Date;
  },
): CrmLeadSnapshot {
  const milestones = Object.fromEntries(
    Object.entries(payload.lifecycle.milestones)
      .filter(([, value]) => value === "1")
      .map(([stage]) => [stage as GweStage, { reached: true }]),
  ) as Partial<CrmLeadSnapshot["lifecycle"]["milestones"]>;

  return {
    tenantId: context.tenantId,
    connectionId: context.connectionId,
    provider: context.provider,
    sourceEvent: {
      id: payload.event.id,
      occurredAt: new Date(payload.event.occurred_at),
      sequence: payload.event.sequence ?? null,
      observedAt: context.observedAt ?? new Date(),
    },
    externalLeadId: payload.lead.external_id,
    identity: {
      name: payload.lead.name,
      email: payload.lead.email,
      phone: payload.lead.phone,
    },
    crm: {
      ownerId: payload.lead.owner.external_id,
      pipeline: {
        id: payload.lead.pipeline.external_id,
        name: payload.lead.pipeline.name,
      },
      stage: {
        id: payload.lead.stage.external_id,
        name: payload.lead.stage.name,
      },
    },
    commercial: payload.lead.value,
    lifecycle: {
      currentStage: payload.lifecycle.current_stage,
      sourceEnteredAt: payload.lifecycle.source_entered_at
        ? new Date(payload.lifecycle.source_entered_at)
        : null,
      historyComplete: payload.lifecycle.history_complete,
      milestones,
    },
    attribution: {
      utmSource: payload.attribution.utm_source,
      utmMedium: payload.attribution.utm_medium,
      utmCampaign: payload.attribution.utm_campaign,
      utmContent: payload.attribution.utm_content,
      utmTerm: payload.attribution.utm_term,
    },
    custom: payload.custom ?? {},
  };
}

export type GweSchemaResult = z.infer<typeof gweV1Schema>;
