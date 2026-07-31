import type { Tenant, TenantRole } from "@/types/database";

export type MembershipLike = {
  tenant_id: string;
  role: TenantRole;
  tenants: Tenant | null;
};

/**
 * Resolve o membership ativo a partir de uma preferência (cookie/API).
 * Só aceita tenant com membership do usuário e is_active=true.
 */
export function resolveActiveMembership(
  memberships: MembershipLike[],
  preferredTenantId?: string | null,
  options?: { allowFallback?: boolean },
): MembershipLike | null {
  const allowFallback = options?.allowFallback !== false;

  if (preferredTenantId) {
    const preferred = memberships.find(
      (m) =>
        m.tenant_id === preferredTenantId &&
        m.tenants != null &&
        m.tenants.is_active,
    );
    if (preferred?.tenants) return preferred;
    if (!allowFallback) return null;
  } else if (!allowFallback) {
    // Chamada explícita (API) sem tenant_id — não inferir outro tenant.
    return null;
  }

  const active = memberships.find((m) => m.tenants?.is_active);
  if (active?.tenants) return active;

  return null;
}
