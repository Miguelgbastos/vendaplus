import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseArgs,
  requireProjectConfirmation,
  requireTenantSlug,
} from "./supabase-cli.mjs";

describe("Supabase setup CLI guards", () => {
  it("parses flags and values", () => {
    assert.deepEqual(
      parseArgs(["--project-ref", "abcdefghijklmnopqrst", "--with-demo"]),
      { "project-ref": "abcdefghijklmnopqrst", "with-demo": true },
    );
  });

  it("requires the exact project ref twice", () => {
    assert.equal(
      requireProjectConfirmation({
        "project-ref": "abcdefghijklmnopqrst",
        "confirm-project": "abcdefghijklmnopqrst",
      }),
      "abcdefghijklmnopqrst",
    );
    assert.throws(
      () => requireProjectConfirmation({
        "project-ref": "abcdefghijklmnopqrst",
        "confirm-project": "differentprojectrefx",
      }),
      /Repita o project ref/,
    );
  });

  it("accepts only tenant-neutral slugs", () => {
    assert.equal(requireTenantSlug({ "tenant-slug": "empresa-demonstracao" }), "empresa-demonstracao");
    assert.throws(() => requireTenantSlug({ "tenant-slug": "Empresa Demo" }), /tenant-slug/);
    assert.throws(() => requireTenantSlug({ "tenant-slug": "demo'; drop table" }), /tenant-slug/);
  });
});
