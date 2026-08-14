import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractLeadIdsFromWebhookPayload } from "./normalize.ts";
import { parseKommoWebhookBody } from "./webhook-payload.ts";

describe("parseKommoWebhookBody", () => {
  it("parses the form-urlencoded payload sent by Kommo without reading the body twice", async () => {
    const request = new Request("https://vendasplus.example/api/webhooks/kommo/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        "leads[status][0][id]": "123456",
        "leads[status][0][status_id]": "654321",
      }),
    });

    const payload = await parseKommoWebhookBody(request);

    assert.equal(payload["leads[status][0][id]"], "123456");
    assert.deepEqual(extractLeadIdsFromWebhookPayload(payload), ["123456"]);
  });

  it("parses JSON payloads", async () => {
    const request = new Request("https://vendasplus.example/api/webhooks/kommo/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leads: [{ id: 123456 }] }),
    });

    assert.deepEqual(await parseKommoWebhookBody(request), {
      leads: [{ id: 123456 }],
    });
  });

  it("parses multipart payloads from the buffered body", async () => {
    const form = new FormData();
    form.set("leads[update][0][id]", "123456");
    const request = new Request("https://vendasplus.example/api/webhooks/kommo/token", {
      method: "POST",
      body: form,
    });

    const payload = await parseKommoWebhookBody(request);

    assert.equal(payload["leads[update][0][id]"], "123456");
  });

  it("rejects payloads above the configured byte limit", async () => {
    const request = new Request("https://vendasplus.example/api/webhooks/kommo/token", {
      method: "POST",
      body: "12345",
    });

    await assert.rejects(
      parseKommoWebhookBody(request, 4),
      /payload_too_large/,
    );
  });
});
