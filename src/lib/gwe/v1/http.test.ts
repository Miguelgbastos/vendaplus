import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GWE_MAX_BODY_BYTES, readGweBody } from "./http.ts";

describe("GWE request body", () => {
  it("accepts exactly 1 MiB", async () => {
    const body = "a".repeat(GWE_MAX_BODY_BYTES);
    assert.equal((await readGweBody(new Request("http://localhost", {
      method: "POST",
      body,
    }))).length, GWE_MAX_BODY_BYTES);
  });

  it("rejects 1 MiB plus one byte", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: "a".repeat(GWE_MAX_BODY_BYTES + 1),
    });
    await assert.rejects(readGweBody(request), /payload_too_large/);
  });
});
