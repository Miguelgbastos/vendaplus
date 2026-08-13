import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveEventCurrency } from "./currency.ts";

describe("resolveEventCurrency", () => {
  it("eventos automáticos (sem currency explícita) usam a moeda do mapping", () => {
    // Regressão: process.ts fixava "BRL" e o mapping.currency nunca era usado.
    assert.equal(resolveEventCurrency(null, "USD"), "USD");
    assert.equal(resolveEventCurrency(undefined, "EUR"), "EUR");
    assert.equal(resolveEventCurrency("", "USD"), "USD");
  });

  it("fluxo manual com currency explícita continua vencendo o mapping", () => {
    assert.equal(resolveEventCurrency("EUR", "USD"), "EUR");
  });

  it("BRL é apenas o último fallback", () => {
    assert.equal(resolveEventCurrency(null, null), "BRL");
    assert.equal(resolveEventCurrency(null, ""), "BRL");
    assert.equal(resolveEventCurrency(undefined, undefined), "BRL");
  });
});
