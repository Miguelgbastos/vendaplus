import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CANONICAL_META_ADS_SOURCE,
  KOMMO_STATUS_LOST,
  KOMMO_STATUS_WON,
  kommoUnixToIso,
  normalizeKommoLead,
  normalizeUtmSource,
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

describe("kommoUnixToIso", () => {
  it("converts unix seconds to ISO", () => {
    assert.equal(kommoUnixToIso(1755021600), "2025-08-12T18:00:00.000Z");
    assert.equal(kommoUnixToIso("1755021600"), "2025-08-12T18:00:00.000Z");
  });

  it("returns null for invalid values", () => {
    assert.equal(kommoUnixToIso(null), null);
    assert.equal(kommoUnixToIso(""), null);
    assert.equal(kommoUnixToIso("abc"), null);
  });
});

describe("normalizeUtmSource", () => {
  it("collapses Meta variants into Meta ADS", () => {
    for (const value of [
      "Meta",
      "meta",
      "Meta Ads",
      "Meta ADS",
      "meta ads",
      "meta_ads",
      "META_ADS",
      "metaads",
    ]) {
      assert.equal(normalizeUtmSource(value), CANONICAL_META_ADS_SOURCE);
    }
  });

  it("leaves unrelated sources untouched", () => {
    assert.equal(normalizeUtmSource("Google"), "Google");
    assert.equal(normalizeUtmSource("{{site_source_name}}"), "{{site_source_name}}");
    assert.equal(normalizeUtmSource(null), null);
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

  it("normalizes utm_source Meta aliases to Meta ADS", () => {
    const normalized = normalizeKommoLead({
      id: 2,
      name: "Lead Meta",
      custom_fields_values: [
        {
          field_code: "UTM_SOURCE",
          values: [{ value: "Meta Ads" }],
        },
      ],
    });

    assert.equal(normalized.utm_source, CANONICAL_META_ADS_SOURCE);
  });

  it("exposes Kommo created_at as ISO createdAt", () => {
    const normalized = normalizeKommoLead({
      id: 3,
      name: "Lead criado",
      created_at: 1755021600,
    });

    assert.equal(normalized.createdAt, "2025-08-12T18:00:00.000Z");
  });

  it("exposes Kommo closed_at as ISO closedAt", () => {
    const normalized = normalizeKommoLead({
      id: 4,
      name: "Lead fechado",
      created_at: 1755021600,
      closed_at: 1755108000,
      status_id: 142,
    });

    assert.equal(normalized.closedAt, "2025-08-13T18:00:00.000Z");
    assert.equal(normalized.qualification, "venda");
  });
});
