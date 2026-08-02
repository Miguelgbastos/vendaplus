export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

export function getKommoRedirectUri(): string {
  return `${getAppUrl()}/api/kommo/oauth/callback`;
}

export function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL não configurada.");
  return url.replace(/\/$/, "");
}

export function getSupabaseAnonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
}

export function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY não configurada.");
  return key;
}

export function getSetupSecret(): string {
  const secret = process.env.SETUP_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SETUP_SECRET deve ter pelo menos 32 caracteres.");
  }
  return secret;
}

export function hasSupabasePublicConfig(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
