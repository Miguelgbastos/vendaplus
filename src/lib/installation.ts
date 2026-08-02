import { createAdminClient } from "@/lib/supabase/admin";

export async function isInstallationComplete(): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("app_installations")
    .select("singleton")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new Error("Não foi possível consultar o estado da instalação.");
  return Boolean(data);
}
