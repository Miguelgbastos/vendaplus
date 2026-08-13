import { createHash, randomBytes } from "node:crypto";

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export function inviteAcceptUrl(appUrl: string, token: string): string {
  const base = appUrl.replace(/\/$/, "");
  const next = `/convite?token=${encodeURIComponent(token)}`;
  return `${base}/api/auth/callback?next=${encodeURIComponent(next)}`;
}
