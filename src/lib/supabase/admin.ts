import { createClient } from "@supabase/supabase-js";
import { getServiceRoleKey, getSupabaseUrl } from "@/lib/env";

export function createAdminClient() {
  return createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
