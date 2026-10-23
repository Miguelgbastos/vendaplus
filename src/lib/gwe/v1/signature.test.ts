import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  GweSignatureError,
  parseGweTimestamp,
  verifyGweSignature,
} from "./signature.ts";

describe("GWE signature", () => {
  const body = '{"a":1,"b":2}';
  const timestamp = 1_800_000_000;
  const secret = "test-secret";

  function signature(rawBody: string): string {
    return `v1=${createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex")}`;
  }

  it("verifies HMAC over the exact raw body", () => {
    verifyGweSignature(body, timestamp, signature(body), secret);
    assert.throws(
      () => verifyGweSignature('{"a": 1, "b": 2}', timestamp, signature(body), secret),
      (error: unknown) =>
        error instanceof GweSignatureError && error.code === "invalid",
    );
  });

  it("rejects malformed signatures", () => {
    assert.throws(
      () => verifyGweSignature(body, timestamp, "v1=not-a-signature", secret),
      (error: unknown) =>
        error instanceof GweSignatureError && error.code === "invalid",
    );
  });

  it("aceita assinatura com hex em maiúsculas", () => {
    const hex = createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex")
      .toUpperCase();
    verifyGweSignature(body, timestamp, `v1=${hex}`, secret);
  });

  it("aceita 5 min no passado e 60s no futuro; recusa fora disso", () => {
    const now = 1_800_000_000;
    assert.equal(parseGweTimestamp(String(now - 300), now), now - 300);
    assert.equal(parseGweTimestamp(String(now + 60), now), now + 60);
    assert.throws(() => parseGweTimestamp(String(now - 301), now));
    assert.throws(() => parseGweTimestamp(String(now + 61), now));
  });
});
