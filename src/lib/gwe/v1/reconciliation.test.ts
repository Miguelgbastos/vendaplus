import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeGwePayload, validateGwePayload } from "./validation.ts";
import { reconcileCrmLeadSnapshot, type ReconciliationState } from "./reconciliation.ts";

const basePayload = {
  schema: "gwe.crm.lead",
  schema_version: 1,
  event: {
    id: "evt-1",
    type: "lead.snapshot",
    occurred_at: "2026-09-21T19:00:00Z",
  },
  lead: {
    external_id: "lead-1",
    name: "Maria",
    email: null,
    phone: null,
    owner: { external_id: null },
    pipeline: { external_id: "pipe-1", name: "Default" },
    stage: { external_id: "stage-1", name: "SQL" },
    value: { amount: null, currency: null },
    created_at: null,
    updated_at: null,
  },
  lifecycle: {
    current_stage: "sql",
    source_entered_at: null,
    history_complete: true,
    milestones: {
      mql: null,
      sal: null,
      sql: "1",
      oportunidade: null,
      negociacao: null,
      venda: null,
      perda: null,
    },
  },
  attribution: {
    utm_source: null, utm_medium: null, utm_campaign: null,
    utm_content: null, utm_term: null,
  },
};

const payload = (overrides: Record<string, unknown> = {}) => ({
  ...basePayload,
  ...overrides,
  event: { ...basePayload.event, ...((overrides.event as object | undefined) ?? {}) },
  lifecycle: { ...basePayload.lifecycle, ...((overrides.lifecycle as object | undefined) ?? {}) },
});

function snapshot(overrides: Record<string, unknown> = {}) {
  return normalizeGwePayload(
    validateGwePayload(payload(overrides)),
    { tenantId: "tenant-1", connectionId: "connection-1", provider: "gwe" },
  );
}

const current: ReconciliationState = {
  leadExists: true,
  currentStage: "sql",
  milestones: { sql: true },
  pipelineId: "pipe-1",
  stageId: "stage-1",
  stageName: "SQL",
  lastSourceEventAt: new Date("2026-09-21T18:00:00Z"),
  lastSourceSequence: 1,
};

describe("reconcileCrmLeadSnapshot", () => {
  it("applies a first snapshot and discovers new milestones", () => {
    const result = reconcileCrmLeadSnapshot(
      { ...current, leadExists: false, milestones: {} },
      snapshot(),
    );
    assert.equal(result.outcome, "applied");
    assert.deepEqual(result.newMilestones, ["sql"]);
  });

  it("returns noop for an identical current snapshot", () => {
    const result = reconcileCrmLeadSnapshot({ ...current, milestones: { sql: true, negociacao: true } }, snapshot({
      event: { id: "evt-2", occurred_at: "2026-09-21T18:00:01Z", sequence: 2 },
    }));
    assert.equal(result.outcome, "noop");
  });

  it("ignores stale sequence and occurred_at events", () => {
    assert.equal(
      reconcileCrmLeadSnapshot(current, snapshot({ event: { id: "evt-old", sequence: 1 } })).outcome,
      "stale_ignored",
    );
    assert.equal(
      reconcileCrmLeadSnapshot(
        { ...current, lastSourceSequence: null },
        snapshot({ event: { id: "evt-old", occurred_at: "2026-09-21T17:59:59Z" } }),
      ).outcome,
      "stale_ignored",
    );
  });

  it("does not regress milestones when the source omits them", () => {
    const result = reconcileCrmLeadSnapshot(
      { ...current, milestones: { sql: true, negociacao: true } },
      snapshot({
      event: { id: "evt-3", occurred_at: "2026-09-21T19:01:00Z", sequence: 3 },
      lifecycle: {
        current_stage: "negociacao",
        source_entered_at: null,
        history_complete: false,
        milestones: {
          mql: null, sal: null, sql: null, oportunidade: null,
          negociacao: "1", venda: null, perda: null,
        },
      },
      }),
    );
    assert.equal(result.outcome, "applied");
    assert.deepEqual(result.newMilestones, []);
  });
});
