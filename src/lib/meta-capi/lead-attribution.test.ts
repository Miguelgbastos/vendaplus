import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractMetaAttribution } from "./lead-attribution.ts";

describe("extractMetaAttribution", () => {
  it("extracts Meta lead_id and browser identifiers from Kommo custom fields", () => {
    assert.deepEqual(
      extractMetaAttribution({
        facebook_lead_id: "1041510245450606",
        fbc: "fb.1.1786590000.click-id",
        _fbp: "fb.1.1786590000.browser-id",
      }),
      {
        leadId: "1041510245450606",
        fbc: "fb.1.1786590000.click-id",
        fbp: "fb.1.1786590000.browser-id",
      },
    );
  });

  it("rejects internal or malformed lead ids", () => {
    assert.equal(extractMetaAttribution({ lead_id: "33202095" }).leadId, null);
    assert.equal(extractMetaAttribution({ lead_id: "not-a-meta-id" }).leadId, null);
  });

  it("accepts normalized custom-field names produced by the Kommo importer", () => {
    assert.equal(
      extractMetaAttribution({ "Facebook Lead ID": "1041510245450606" }).leadId,
      "1041510245450606",
    );
  });
});
