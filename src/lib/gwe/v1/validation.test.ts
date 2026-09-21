import assert from "node:assert/strict";
import test from "node:test";
import {
  GweValidationError,
  hashCanonicalJson,
  normalizeGwePayload,
  validateGwePayload,
} from "./index.ts";
import type { GweV1Payload } from "./types.ts";

const validPayload: GweV1Payload = {
  schema: "gwe.crm.lead",
  schema_version: 1,
  event: {
    id: "evt-1",
    type: "lead.snapshot",
    occurred_at: "2026-09-21T19:40:00-03:00",
    sequence: 1,
  },
  lead: {
    external_id: "lead-1",
    name: null,
    email: "maria@example.com",
    phone: null,
    owner: { external_id: null },
    pipeline: { external_id: "pipeline-1", name: "Comercial" },
    stage: { external_id: "stage-1", name: "SQL" },
    value: { amount: 12500.5, currency: "BRL" },
    created_at: null,
    updated_at: "2026-09-21T19:40:00Z",
  },
  lifecycle: {
    current_stage: "sql",
    source_entered_at: "2026-09-20T12:00:00Z",
    history_complete: true,
    milestones: {
      mql: "1",
      sal: "1",
      sql: "1",
      oportunidade: null,
      negociacao: null,
      venda: null,
      perda: null,
    },
  },
  attribution: {
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
  },
  custom: {},
};

test("valida e normaliza um snapshot GWE v1", () => {
  const payload = validateGwePayload(validPayload);
  const snapshot = normalizeGwePayload(payload, {
    tenantId: "tenant-1",
    connectionId: "connection-1",
    provider: "generic",
  });

  assert.equal(snapshot.lifecycle.currentStage, "sql");
  assert.deepEqual(snapshot.lifecycle.milestones.sql, { reached: true });
  assert.equal(snapshot.lifecycle.milestones.oportunidade, undefined);
  assert.equal(snapshot.identity.name, null);
  assert.equal(snapshot.commercial.amount, 12500.5);
});

test("exige todos os campos do snapshot, mesmo quando nullable", () => {
  const invalid = structuredClone(validPayload);
  delete (invalid.lead as { phone?: string | null }).phone;

  assert.throws(
    () => validateGwePayload(invalid),
    (error: unknown) =>
      error instanceof GweValidationError &&
      error.issues.some((issue) => issue.path === "lead.phone"),
  );
});

test("rejeita milestone incompatível com o estágio atual", () => {
  const invalid = structuredClone(validPayload);
  invalid.lifecycle.milestones.sql = null;

  assert.throws(
    () => validateGwePayload(invalid),
    (error: unknown) =>
      error instanceof GweValidationError &&
      error.issues[0]?.code === "current_stage_milestone_mismatch",
  );
});

test("permite venda e perda como milestones históricos", () => {
  const payload = structuredClone(validPayload);
  payload.lifecycle.current_stage = "venda";
  payload.lifecycle.milestones.venda = "1";
  payload.lifecycle.milestones.perda = "1";

  assert.doesNotThrow(() => validateGwePayload(payload));
});

test("canonicalização ignora ordem das propriedades", () => {
  const first = { b: 2, a: { d: true, c: 1 } };
  const second = { a: { c: 1, d: true }, b: 2 };

  assert.equal(hashCanonicalJson(first), hashCanonicalJson(second));
});

test("rejeita datas sem timezone", () => {
  const invalid = structuredClone(validPayload);
  invalid.event.occurred_at = "2026-09-21 19:40:00";

  assert.throws(() => validateGwePayload(invalid), GweValidationError);
});
