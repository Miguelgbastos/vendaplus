import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  KOMMO_STATUS_LOST,
  KOMMO_STATUS_WON,
  normalizeKommoLead,
  qualificationFromKommoStatusId,
} from "./normalize.ts";

describe("qualificationFromKommoStatusId", () => {
  it("maps system won/lost status ids", () => {
    assert.equal(qualificationFromKommoStatusId(KOMMO_STATUS_WON), "venda");
    assert.equal(qualificationFromKommoStatusId(142), "venda");
    assert.equal(qualificationFromKommoStatusId(KOMMO_STATUS_LOST), "perda");
    assert.equal(qualificationFromKommoStatusId("100746860"), null);
  });
});

describe("normalizeKommoLead system statuses", () => {
  it("forces venda when status_id is 142 even with intermediate stage aliases", () => {
    const normalized = normalizeKommoLead({
      id: 33202095,
      name: "Lead ganho",
      status_id: 142,
      pipeline_id: 11107123,
      price: 1000,
      custom_fields_values: [
        {
          field_name: "Etapa",
          values: [{ value: "Negociação" }],
        },
      ],
    });

    assert.equal(normalized.qualification, "venda");
    assert.equal(normalized.statusId, "142");
  });

  it("forces perda when status_id is 143", () => {
    const normalized = normalizeKommoLead({
      id: 1,
      name: "Lead perdido",
      status_id: 143,
      custom_fields_values: [
        {
          field_name: "qualification",
          values: [{ value: "SQL" }],
        },
      ],
    });

    assert.equal(normalized.qualification, "perda");
  });
});
