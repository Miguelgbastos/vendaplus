import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskWebhookUrl } from "./webhook-url.ts";

describe("maskWebhookUrl", () => {
  it("preserves the destination while hiding the webhook token", () => {
    const token = "secret-webhook-token";
    const masked = maskWebhookUrl(
      `https://vendasplus.example/api/webhooks/kommo/${token}`,
    );

    assert.match(masked, /^https:\/\/vendasplus\.example\/api\/webhooks\/kommo\//);
    assert.match(masked, /••••••••••••$/);
    assert.doesNotMatch(masked, new RegExp(token));
  });

  it("does not echo malformed input", () => {
    assert.equal(maskWebhookUrl("secret-webhook-token"), "URL do webhook protegida");
  });
});
