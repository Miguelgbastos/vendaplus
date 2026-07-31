import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";

export function createClient() {
  const key = getSupabaseAnonKey();
  if (!key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY não configurada. Copie .env.example para .env.local.",
    );
  }
  return createBrowserClient(getSupabaseUrl(), key);
}
