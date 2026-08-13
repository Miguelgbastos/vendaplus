import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createInviteToken,
  hashInviteToken,
  inviteAcceptUrl,
} from "./invite-token.ts";

describe("invite tokens", () => {
  it("hashes tokens with SHA-256 hex", () => {
    const hash = hashInviteToken("demo-token");
    assert.equal(hash.length, 64);
    assert.equal(hash, hashInviteToken("demo-token"));
    assert.notEqual(hash, hashInviteToken("other-token"));
  });

  it("creates high-entropy tokens distinct from their hashes", () => {
    const a = createInviteToken();
    const b = createInviteToken();
    assert.notEqual(a.token, b.token);
    assert.equal(a.tokenHash, hashInviteToken(a.token));
    assert.notEqual(a.token, a.tokenHash);
  });

  it("builds internal accept URLs", () => {
    const url = inviteAcceptUrl("https://app.example.com", "abc.def");
    assert.equal(url, "https://app.example.com/convite?token=abc.def");
  });
});
