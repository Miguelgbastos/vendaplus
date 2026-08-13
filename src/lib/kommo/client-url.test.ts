import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildKommoApiUrl } from "./api-url.ts";

describe("buildKommoApiUrl", () => {
  it("builds relative API paths", () => {
    assert.equal(
      buildKommoApiUrl("acme", "/api/v4/leads/123?with=contacts"),
      "https://acme.kommo.com/api/v4/leads/123?with=contacts",
    );
  });

  it("rejects absolute URLs and traversal", () => {
    assert.throws(() => buildKommoApiUrl("acme", "https://evil.test/x"), /absolute/);
    assert.throws(() => buildKommoApiUrl("acme", "/api/v4/leads/1/../../users"), /traversal/);
    assert.throws(() => buildKommoApiUrl("acme", "/v4/leads/1"), /not_allowed/);
  });
});
