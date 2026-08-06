import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import {
  getActiveTenant,
  getUserMemberships,
  requireUser,
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await requireUser();
  if (!userId) redirect("/login");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("id", userId)
    .maybeSingle();

  // getActiveTenant reuses getUserMemberships via React.cache (same request).
  const [membership, memberships] = await Promise.all([
    getActiveTenant(userId),
    getUserMemberships(userId),
  ]);

  const tenants = memberships
    .filter((m) => m.tenants?.is_active)
    .map((m) => ({
      id: m.tenants!.id,
      name: m.tenants!.name,
      slug: m.tenants!.slug,
      role: m.role,
    }));

  return (
    <AppShell
      tenantName={membership?.tenant.name}
      activeTenantId={membership?.tenant.id}
      tenants={tenants}
      userEmail={profile?.email || profile?.full_name}
    >
      {children}
    </AppShell>
  );
}
