import type { QualificationStage } from "../../../types/database.ts";

export const GWE_SCHEMA = "gwe.crm.lead" as const;
export const GWE_SCHEMA_VERSION = 1 as const;
export const GWE_EVENT_TYPE = "lead.snapshot" as const;

export const GWE_STAGES = [
  "mql",
  "sal",
  "sql",
  "oportunidade",
  "negociacao",
  "venda",
  "perda",
] as const satisfies readonly QualificationStage[];

export type GweStage = (typeof GWE_STAGES)[number];
export type GweMilestoneValue = "1" | null;

export type GweV1Payload = {
  schema: typeof GWE_SCHEMA;
  schema_version: typeof GWE_SCHEMA_VERSION;
  event: {
    id: string;
    type: typeof GWE_EVENT_TYPE;
    occurred_at: string;
    sequence?: number;
  };
  lead: {
    external_id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    owner: { external_id: string | null };
    pipeline: { external_id: string | null; name: string | null };
    stage: { external_id: string | null; name: string | null };
    value: { amount: number | null; currency: string | null };
    created_at: string | null;
    updated_at: string | null;
  };
  lifecycle: {
    current_stage: GweStage | null;
    source_entered_at: string | null;
    history_complete: boolean;
    milestones: Record<GweStage, GweMilestoneValue>;
  };
  attribution: {
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
  };
  custom?: Record<string, unknown>;
};

export type LifecycleMilestone = { reached: boolean };

export type CrmLeadSnapshot = {
  tenantId: string;
  connectionId: string;
  provider: string;
  sourceEvent: {
    id: string;
    occurredAt: Date;
    sequence: number | null;
    observedAt: Date;
  };
  externalLeadId: string;
  identity: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  crm: {
    ownerId: string | null;
    pipeline: { id: string | null; name: string | null };
    stage: { id: string | null; name: string | null };
  };
  commercial: { amount: number | null; currency: string | null };
  lifecycle: {
    currentStage: GweStage | null;
    sourceEnteredAt: Date | null;
    historyComplete: boolean;
    milestones: Partial<Record<GweStage, LifecycleMilestone>>;
  };
  attribution: {
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
  };
  custom: Record<string, unknown>;
};
