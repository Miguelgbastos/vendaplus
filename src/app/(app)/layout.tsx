import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getActiveTenant, requireUser } from "@/lib/auth";
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

  const membership = await getActiveTenant(userId);

  return (
    <AppShell
      tenantName={membership?.tenant.name}
      userEmail={profile?.email || profile?.full_name}
    >
      {children}
    </AppShell>
  );
}
