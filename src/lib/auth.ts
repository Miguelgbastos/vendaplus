import { createClient } from "@/lib/supabase/server";
import type { Tenant, TenantRole, TenantUser } from "@/types/database";

export async function requireUser() {
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
}

export type Membership = TenantUser & {
  tenants: Tenant | null;
};

export async function getUserMemberships(userId: string) {
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
}

export async function getActiveTenant(
  userId: string,
  preferredTenantId?: string | null,
): Promise<{ tenant: Tenant; role: TenantRole } | null> {
  const memberships = await getUserMemberships(userId);
  if (!memberships.length) return null;

  const match =
    (preferredTenantId &&
      memberships.find((m) => m.tenant_id === preferredTenantId && m.tenants)) ||
    memberships.find((m) => m.tenants?.is_active) ||
    memberships[0];

  if (!match?.tenants) return null;
  return { tenant: match.tenants, role: match.role };
}

export function canManageTenant(role: TenantRole): boolean {
  return role === "owner" || role === "admin";
}
