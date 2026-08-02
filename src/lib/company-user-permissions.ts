import type { TenantRole } from "@/types/database";

export const COMPANY_ROLES: TenantRole[] = ["owner", "admin", "analyst", "viewer"];

export const COMPANY_ROLE_LABELS: Record<TenantRole, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  analyst: "Analista",
  viewer: "Leitor",
};

export function rolesAssignableBy(role: TenantRole): TenantRole[] {
  return role === "owner" ? COMPANY_ROLES : COMPANY_ROLES.filter((item) => item !== "owner");
}

export function canChangeCompanyMember(
  actorRole: TenantRole,
  targetRole: TenantRole,
  nextRole?: TenantRole,
): boolean {
  if (actorRole === "owner") return true;
  if (actorRole !== "admin" || targetRole === "owner") return false;
  return nextRole !== "owner";
}

export function wouldRemoveLastOwner(
  targetRole: TenantRole,
  nextRole: TenantRole | null,
  ownerCount: number,
): boolean {
  return targetRole === "owner" && nextRole !== "owner" && ownerCount <= 1;
}
