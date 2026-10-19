import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  commercialStageFromMilestones,
  previousCommercialStageFromEvents,
  resolveQualificationFromStatusId,
} from "./backfill-loss-resolve.ts";
import { KOMMO_STATUS_LOST } from "./normalize.ts";

describe("commercialStageFromMilestones", () => {
  it("escolhe o estágio comercial mais avançado", () => {
    assert.equal(
      commercialStageFromMilestones({ sql: "1", oportunidade: "1" }),
      "oportunidade",
    );
    assert.equal(
      commercialStageFromMilestones({
        sql: "1",
        Negociação: "1",
      }),
      "negociacao",
    );
    assert.equal(commercialStageFromMilestones({ mql: "1", sal: "1" }), null);
  });
});

describe("previousCommercialStageFromEvents", () => {
  it("usa value_before da última mudança para perda", () => {
    const result = previousCommercialStageFromEvents(
      [
        {
          id: "1",
          type: "lead_status_changed",
          entity_id: 10,
          created_at: 100,
          value_before: [{ lead_status: { id: 111 } }],
          value_after: [{ lead_status: { id: Number(KOMMO_STATUS_LOST) } }],
        },
        {
          id: "2",
          type: "lead_status_changed",
          entity_id: 10,
          created_at: 200,
          value_before: [{ lead_status: { id: 222 } }],
          value_after: [{ lead_status: { id: Number(KOMMO_STATUS_LOST) } }],
        },
      ],
      { "222": "Oportunidade", "111": "SQL" },
    );
    assert.equal(result?.stage, "oportunidade");
  });

  it("ignora perda sem estágio comercial anterior", () => {
    const result = previousCommercialStageFromEvents(
      [
        {
          id: "1",
          type: "lead_status_changed",
          entity_id: 10,
          created_at: 100,
          value_before: [{ lead_status: { id: 50 } }],
          value_after: [{ lead_status: { id: Number(KOMMO_STATUS_LOST) } }],
        },
      ],
      { "50": "MQL" },
    );
    assert.equal(result, null);
  });
});

describe("resolveQualificationFromStatusId", () => {
  it("prioriza status de sistema e cai no nome do pipeline", () => {
    assert.equal(resolveQualificationFromStatusId(KOMMO_STATUS_LOST), "perda");
    assert.equal(
      resolveQualificationFromStatusId("999", { "999": "Negociação" }),
      "negociacao",
    );
  });
});
