import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";

export const createClient = cache(async () => {
  const cookieStore = await cookies();
  const key = getSupabaseAnonKey();
  if (!key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY não configurada. Copie .env.example para .env.local.",
    );
  }

  return createServerClient(getSupabaseUrl(), key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Chamado de Server Component — o proxy renova a sessão.
        }
      },
    },
  });
});
