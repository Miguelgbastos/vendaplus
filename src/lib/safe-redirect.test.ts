import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeInternalPath } from "./safe-redirect.ts";

describe("safeInternalPath", () => {
  it("keeps internal paths", () => {
    assert.equal(safeInternalPath("/dashboard"), "/dashboard");
    assert.equal(safeInternalPath("/configuracoes/usuarios?x=1"), "/configuracoes/usuarios?x=1");
  });

  it("rejects open redirects", () => {
    assert.equal(safeInternalPath("https://evil.com"), "/dashboard");
    assert.equal(safeInternalPath("//evil.com"), "/dashboard");
    assert.equal(safeInternalPath("/\\evil.com"), "/dashboard");
    assert.equal(safeInternalPath("dashboard"), "/dashboard");
    assert.equal(safeInternalPath(null, "/login"), "/login");
  });
});
