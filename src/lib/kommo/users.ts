import { kommoFetch } from "@/lib/kommo/client";
import { parseKommoUsersPage, type KommoDirectoryUser } from "@/lib/kommo/user-directory";
import { createAdminClient } from "@/lib/supabase/admin";

const USERS_PAGE_LIMIT = 250;
const MAX_USERS_PAGES = 100;
const WRITE_BATCH_SIZE = 250;

type KommoUsersPage = {
  _embedded?: { users?: unknown[] };
  _links?: { next?: { href?: string } };
};

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export async function fetchAllKommoUsers(
  tenantId: string,
): Promise<KommoDirectoryUser[]> {
  const users = new Map<string, KommoDirectoryUser>();

  for (let page = 1; page <= MAX_USERS_PAGES; page += 1) {
    const payload = await kommoFetch<KommoUsersPage>(
      tenantId,
      `/api/v4/users?limit=${USERS_PAGE_LIMIT}&page=${page}`,
    );
    const parsed = parseKommoUsersPage(payload);
    for (const user of parsed.users) users.set(user.kommoUserId, user);
    if (!parsed.hasNext) return [...users.values()];
  }

  throw new Error("kommo_users_pagination_limit");
}

export async function syncKommoUsers(tenantId: string): Promise<{
  synced: number;
  inactive: number;
  syncedAt: string;
}> {
  const users = await fetchAllKommoUsers(tenantId);
  const admin = createAdminClient();
  const syncedAt = new Date().toISOString();

  for (const batch of chunks(users, WRITE_BATCH_SIZE)) {
    const { error } = await admin.from("kommo_users").upsert(
      batch.map((user) => ({
        tenant_id: tenantId,
        kommo_user_id: user.kommoUserId,
        name: user.name,
        is_active: user.isActive,
        synced_at: syncedAt,
      })),
      { onConflict: "tenant_id,kommo_user_id" },
    );
    if (error) throw new Error(`kommo_users_upsert_failed:${error.message}`);
  }

  const currentIds = new Set(users.map((user) => user.kommoUserId));
  const { data: existing, error: existingError } = await admin
    .from("kommo_users")
    .select("kommo_user_id")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (existingError) {
    throw new Error(`kommo_users_stale_lookup_failed:${existingError.message}`);
  }

  const staleIds = (existing ?? [])
    .map((row) => String(row.kommo_user_id))
    .filter((id) => !currentIds.has(id));

  for (const batch of chunks(staleIds, WRITE_BATCH_SIZE)) {
    const { error } = await admin
      .from("kommo_users")
      .update({ is_active: false, synced_at: syncedAt })
      .eq("tenant_id", tenantId)
      .in("kommo_user_id", batch);
    if (error) throw new Error(`kommo_users_deactivate_failed:${error.message}`);
  }

  return { synced: users.length, inactive: staleIds.length, syncedAt };
}
