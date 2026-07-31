import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveActiveMembership } from "./resolve-active-membership.ts";
import type { MembershipLike } from "./resolve-active-membership.ts";

function m(
  id: string,
  name: string,
  active: boolean,
  role: MembershipLike["role"] = "owner",
): MembershipLike {
  return {
    tenant_id: id,
    role,
    tenants: { id, name, slug: name.toLowerCase(), is_active: active },
  };
}

describe("resolveActiveMembership", () => {
  const woman = m("11111111-1111-4111-8111-111111111111", "WomanTrip", true);
  const uniex = m("22222222-2222-4222-8222-222222222222", "Uniex", true);
  const inactive = m("33333333-3333-4333-8333-333333333333", "OldCo", false);

  it("usa preferred válido (cookie/API)", () => {
    const result = resolveActiveMembership([woman, uniex], uniex.tenant_id);
    assert.equal(result?.tenants?.name, "Uniex");
  });

  it("rejeita preferred de outro tenant / sem membership", () => {
    const result = resolveActiveMembership(
      [woman],
      uniex.tenant_id,
      { allowFallback: false },
    );
    assert.equal(result, null);
  });

  it("rejeita preferred inativo sem fallback", () => {
    const result = resolveActiveMembership(
      [woman, inactive],
      inactive.tenant_id,
      { allowFallback: false },
    );
    assert.equal(result, null);
  });

  it("faz fallback quando cookie inválido", () => {
    const result = resolveActiveMembership(
      [woman, uniex],
      "00000000-0000-4000-8000-000000000000",
      { allowFallback: true },
    );
    assert.equal(result?.tenants?.name, "WomanTrip");
  });

  it("faz fallback quando cookie ausente", () => {
    const result = resolveActiveMembership([uniex, woman], null, {
      allowFallback: true,
    });
    assert.equal(result?.tenants?.name, "Uniex");
  });

  it("API sem tenant_id não infere tenant", () => {
    const result = resolveActiveMembership([woman, uniex], null, {
      allowFallback: false,
    });
    assert.equal(result, null);
  });

  it("ignora tenants inativos no fallback", () => {
    const result = resolveActiveMembership([inactive], null, {
      allowFallback: true,
    });
    assert.equal(result, null);
  });
});
