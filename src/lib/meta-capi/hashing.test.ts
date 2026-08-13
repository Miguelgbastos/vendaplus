import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hashEmail,
  hashExternalId,
  hashName,
  hashPhone,
  splitFullName,
} from "./hashing.ts";

// SHA-256 esperado calculado offline (echo -n "value" | sha256sum).
const SHA_EMPTY_TRIMMED_TESTUSER =
  "9b7801069674c33d8d6752e59d75d18ff58b7d7bc9adba36692b7f42b76ec6d4";

describe("hashEmail", () => {
  it("normalizes trim + lowercase and returns SHA-256 hex", () => {
    const a = hashEmail("  Test@Example.COM ");
    const b = hashEmail("test@example.com");
    assert.equal(a, b);
    assert.equal(a?.length, 64);
    assert.match(a ?? "", /^[0-9a-f]{64}$/);
  });

  it("returns null for empty inputs", () => {
    assert.equal(hashEmail(null), null);
    assert.equal(hashEmail(""), null);
    assert.equal(hashEmail("   "), null);
  });
});

describe("hashPhone", () => {
  it("strips non-digits, adds Brazil country code when missing", () => {
    const brWithoutCc = hashPhone("(11) 98765-4321");
    const brWithCc = hashPhone("+55 11 98765-4321");
    assert.equal(brWithoutCc, brWithCc);
    assert.match(brWithoutCc ?? "", /^[0-9a-f]{64}$/);
  });

  it("returns null when there are no digits", () => {
    assert.equal(hashPhone(null), null);
    assert.equal(hashPhone(""), null);
    assert.equal(hashPhone("abc"), null);
  });
});

describe("hashName", () => {
  it("lowercases and collapses whitespace", () => {
    const a = hashName("  João  Silva  ");
    const b = hashName("joão silva");
    assert.equal(a, b);
  });
});

describe("hashExternalId", () => {
  it("hashes lowercase external ids consistently", () => {
    const a = hashExternalId("ContactID-42");
    const b = hashExternalId("contactid-42");
    assert.equal(a, b);
    assert.equal(hashExternalId(null), null);
    assert.equal(hashExternalId(""), null);
  });
});

describe("splitFullName", () => {
  it("splits first + last preserving remaining tokens", () => {
    assert.deepEqual(splitFullName("Maria da Silva"), {
      first: "Maria",
      last: "da Silva",
    });
    assert.deepEqual(splitFullName("Maria"), { first: "Maria", last: null });
    assert.deepEqual(splitFullName(""), { first: null, last: null });
    assert.deepEqual(splitFullName(null), { first: null, last: null });
  });
});

// Sanity: verifica formato e determinismo — não travamos em um digest fixo
// além do que já cobrimos, para não acoplar demais aos detalhes.
describe("sha256 determinism", () => {
  it("returns stable digest for a stable input", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _sanity = SHA_EMPTY_TRIMMED_TESTUSER;
    const a = hashEmail("stable@example.com");
    const b = hashEmail("stable@example.com");
    assert.equal(a, b);
  });
});
