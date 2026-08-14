import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getSupabaseInvocation,
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

  it("invokes the local CLI through Node without relying on platform shell wrappers", () => {
    const invocation = getSupabaseInvocation(["--version"]);

    assert.equal(invocation.command, process.execPath);
    assert.match(invocation.args[0], /supabase[/\\]dist[/\\]supabase\.js$/);
    assert.deepEqual(invocation.args.slice(1), ["--version"]);
  });
});
