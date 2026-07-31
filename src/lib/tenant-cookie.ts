import { cookies } from "next/headers";

export const ACTIVE_TENANT_COOKIE = "vp_active_tenant";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 ano

export async function getActiveTenantIdFromCookie(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(ACTIVE_TENANT_COOKIE)?.value?.trim();
  if (!value) return null;
  // UUID v4-ish shape; rejeita lixo óbvio antes da validação de membership
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    return null;
  }
  return value;
}

export async function setActiveTenantCookie(tenantId: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function clearActiveTenantCookie(): Promise<void> {
  const store = await cookies();
  store.delete(ACTIVE_TENANT_COOKIE);
}
