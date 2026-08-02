import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canChangeCompanyMember,
  rolesAssignableBy,
  wouldRemoveLastOwner,
} from "./company-user-permissions.ts";

describe("company user permissions", () => {
  it("permite que proprietário atribua qualquer papel", () => {
    assert.deepEqual(rolesAssignableBy("owner"), ["owner", "admin", "analyst", "viewer"]);
  });

  it("impede administrador de conceder ou alterar proprietário", () => {
    assert.equal(rolesAssignableBy("admin").includes("owner"), false);
    assert.equal(canChangeCompanyMember("admin", "owner", "viewer"), false);
    assert.equal(canChangeCompanyMember("admin", "viewer", "owner"), false);
  });

  it("protege o último proprietário", () => {
    assert.equal(wouldRemoveLastOwner("owner", null, 1), true);
    assert.equal(wouldRemoveLastOwner("owner", "admin", 1), true);
    assert.equal(wouldRemoveLastOwner("owner", null, 2), false);
  });
});
