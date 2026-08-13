import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resetRateLimitForTests, takeRateLimit } from "./rate-limit.ts";

describe("takeRateLimit", () => {
  it("allows up to the limit and then blocks", () => {
    resetRateLimitForTests();
    const key = `test:${Date.now()}`;
    assert.equal(takeRateLimit(key, 2, 60_000).ok, true);
    assert.equal(takeRateLimit(key, 2, 60_000).ok, true);
    const blocked = takeRateLimit(key, 2, 60_000);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.ok(blocked.retryAfterSec >= 1);
  });
});
