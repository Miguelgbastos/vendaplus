import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ownerLabel, parseKommoUsersPage } from "./user-directory.ts";

describe("parseKommoUsersPage", () => {
  it("normalizes valid users and preserves inactive users for historical labels", () => {
    const result = parseKommoUsersPage({
      _embedded: {
        users: [
          { id: 10, name: " Ana Paula ", rights: { is_active: true } },
          { id: "20", name: "Bruno", rights: { is_active: false } },
          { id: "../../admin", name: "Inválido" },
          { id: 30, name: "   " },
        ],
      },
      _links: { next: { href: "https://example.test/page=2" } },
    });

    assert.deepEqual(result, {
      users: [
        { kommoUserId: "10", name: "Ana Paula", isActive: true },
        { kommoUserId: "20", name: "Bruno", isActive: false },
      ],
      hasNext: true,
    });
  });

  it("handles an empty final page", () => {
    assert.deepEqual(parseKommoUsersPage({}), { users: [], hasNext: false });
  });
});

describe("ownerLabel", () => {
  it("uses the synced name and falls back safely", () => {
    assert.equal(ownerLabel("10", { "10": "Ana Paula" }), "Ana Paula");
    assert.equal(ownerLabel("20", {}), "#20");
    assert.equal(ownerLabel("externo", {}), "externo");
  });
});
