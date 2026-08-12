import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMetaCapiEvent, generateEventId } from "./event.ts";

describe("buildMetaCapiEvent", () => {
  it("hashes PII, drops empty fields and converts time to seconds", () => {
    const event = buildMetaCapiEvent({
      eventName: "Purchase",
      eventTimeMs: 1_780_000_000_000,
      actionSource: "system_generated",
      user: {
        email: "  Test@Example.COM ",
        phone: "(11) 98765-4321",
        full_name: "Maria da Silva",
        external_id: "contact-1",
      },
      custom: {
        value: 1234.5,
        currency: "brl",
        utm_source: "meta_ads",
      },
    });

    assert.equal(event.event_name, "Purchase");
    assert.equal(event.event_time, 1_780_000_000);
    assert.equal(event.action_source, "system_generated");
    assert.equal(typeof event.event_id, "string");
    assert.ok(event.event_id.length > 5);

    const ud = event.user_data as Record<string, string[] | string>;
    assert.equal((ud.em as string[])[0].length, 64);
    assert.equal((ud.ph as string[])[0].length, 64);
    assert.equal((ud.fn as string[])[0].length, 64);
    assert.equal((ud.ln as string[])[0].length, 64);
    assert.equal((ud.external_id as string[])[0].length, 64);
    assert.equal(ud.client_ip_address, undefined);

    assert.equal(event.custom_data?.value, 1234.5);
    assert.equal(event.custom_data?.currency, "brl");
    assert.equal(event.custom_data?.utm_source, "meta_ads");
  });

  it("omits user_data fields when the source is empty", () => {
    const event = buildMetaCapiEvent({
      eventName: "Lead",
      eventTimeMs: 1000,
      user: {},
    });
    assert.deepEqual(event.user_data, {});
    assert.equal(event.custom_data, undefined);
  });

  it("uses derived first/last from full_name when explicit ones are absent", () => {
    const withDerived = buildMetaCapiEvent({
      eventName: "Lead",
      eventTimeMs: 1000,
      user: { full_name: "Maria da Silva" },
    });
    const withExplicit = buildMetaCapiEvent({
      eventName: "Lead",
      eventTimeMs: 1000,
      user: { first_name: "Maria", last_name: "da Silva" },
    });
    assert.equal(
      (withDerived.user_data.fn as string[])[0],
      (withExplicit.user_data.fn as string[])[0],
    );
    assert.equal(
      (withDerived.user_data.ln as string[])[0],
      (withExplicit.user_data.ln as string[])[0],
    );
  });

  it("preserves an explicit event_id for retry deduplication", () => {
    const event = buildMetaCapiEvent({
      eventName: "Lead",
      eventTimeMs: 1000,
      eventId: "job-stable-event-id",
      user: { external_id: "contact-1" },
    });

    assert.equal(event.event_id, "job-stable-event-id");
  });
});

describe("generateEventId", () => {
  it("returns unique ids", () => {
    const a = generateEventId();
    const b = generateEventId();
    assert.notEqual(a, b);
    assert.match(a, /^[a-z0-9]+-[0-9a-f]+$/);
  });
});
