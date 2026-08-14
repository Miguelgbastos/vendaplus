export type KommoDirectoryUser = {
  kommoUserId: string;
  name: string;
  isActive: boolean;
};

type KommoUserPayload = {
  id?: unknown;
  name?: unknown;
  rights?: { is_active?: unknown } | null;
};

type KommoUsersPagePayload = {
  _embedded?: { users?: unknown } | null;
  _links?: { next?: { href?: unknown } | null } | null;
};

export function parseKommoUsersPage(payload: unknown): {
  users: KommoDirectoryUser[];
  hasNext: boolean;
} {
  const page = (payload && typeof payload === "object"
    ? payload
    : {}) as KommoUsersPagePayload;
  const rawUsers = Array.isArray(page._embedded?.users)
    ? (page._embedded.users as KommoUserPayload[])
    : [];

  const users: KommoDirectoryUser[] = [];
  for (const raw of rawUsers) {
    const kommoUserId = String(raw?.id ?? "").trim();
    const name = String(raw?.name ?? "").trim();
    if (!/^[1-9]\d*$/.test(kommoUserId) || !name) continue;
    users.push({
      kommoUserId,
      name,
      isActive: raw.rights?.is_active !== false,
    });
  }

  return {
    users,
    hasNext: typeof page._links?.next?.href === "string",
  };
}

export function ownerLabel(
  ownerId: string,
  names: Readonly<Record<string, string>> = {},
): string {
  const name = names[ownerId]?.trim();
  if (name) return name;
  return /^\d+$/.test(ownerId) ? `#${ownerId}` : ownerId;
}
