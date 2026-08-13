import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveClosedAt } from "./closed-at.ts";

describe("resolveClosedAt", () => {
  it("returns null for open stages", () => {
    assert.equal(
      resolveClosedAt({
        qualification: "sql",
        kommoClosedAt: "2026-01-01T00:00:00.000Z",
        previousClosedAt: "2026-01-02T00:00:00.000Z",
      }),
      null,
    );
  });

  it("prefers Kommo closed_at and never invents now()", () => {
    assert.equal(
      resolveClosedAt({
        qualification: "venda",
        kommoClosedAt: "2026-01-01T00:00:00.000Z",
        previousClosedAt: "2026-01-02T00:00:00.000Z",
      }),
      "2026-01-01T00:00:00.000Z",
    );
    assert.equal(
      resolveClosedAt({
        qualification: "perda",
        kommoClosedAt: null,
        previousClosedAt: "2026-01-02T00:00:00.000Z",
      }),
      "2026-01-02T00:00:00.000Z",
    );
    assert.equal(
      resolveClosedAt({
        qualification: "venda",
        kommoClosedAt: null,
        previousClosedAt: null,
      }),
      null,
    );
  });
});
