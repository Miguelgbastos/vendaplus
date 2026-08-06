import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getActiveTenantIdFromCookie } from "@/lib/tenant-cookie";
import { resolveActiveMembership } from "@/lib/resolve-active-membership";
import type { Tenant, TenantRole, TenantUser } from "@/types/database";

export const requireUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    return { supabase, userId: null as string | null, claims: null };
  }
  return {
    supabase,
    userId: data.claims.sub as string,
    claims: data.claims,
  };
});

export type Membership = TenantUser & {
  tenants: Tenant | null;
};

export const getUserMemberships = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenant_users")
    .select("id, tenant_id, user_id, role, tenants(id, name, slug, is_active)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getUserMemberships", error.message);
    return [] as Membership[];
  }

  return (data ?? []) as unknown as Membership[];
});

/**
 * Resolve o tenant ativo.
 * - Sem preferredTenantId: lê cookie httpOnly e faz fallback seguro.
 * - Com preferredTenantId (APIs): exige membership + tenant ativo; sem fallback.
 */
export const getActiveTenant = cache(async (
  userId: string,
  preferredTenantId?: string | null,
): Promise<{ tenant: Tenant; role: TenantRole } | null> => {
  const memberships = await getUserMemberships(userId);
  if (!memberships.length) return null;

  const fromArg = preferredTenantId !== undefined;
  const preferred = fromArg
    ? preferredTenantId
    : await getActiveTenantIdFromCookie();

  const match = resolveActiveMembership(memberships, preferred, {
    allowFallback: !fromArg,
  });

  if (!match?.tenants) return null;
  return { tenant: match.tenants, role: match.role };
});

export function canManageTenant(role: TenantRole): boolean {
  return role === "owner" || role === "admin";
}
