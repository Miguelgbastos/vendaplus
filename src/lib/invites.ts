import { createAdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/env";
import {
  createInviteToken,
  hashInviteToken,
  inviteAcceptUrl as buildInviteAcceptUrl,
} from "@/lib/invite-token";
import type { TenantRole } from "@/types/database";

export type InviteStatus = "pending" | "accepted" | "cancelled" | "expired";

export {
  createInviteToken,
  hashInviteToken,
} from "@/lib/invite-token";

export function inviteAcceptUrl(token: string): string {
  return buildInviteAcceptUrl(getAppUrl(), token);
}

export async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const admin = createAdminClient();
  const normalized = email.trim().toLowerCase();
  const { data, error } = await admin.rpc("find_auth_user_id_by_email", {
    p_email: normalized,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

export async function writeAudit(input: {
  tenantId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  // Prefer authenticated client when available; falls back to admin (service).
  supabase?: { rpc: ReturnType<typeof createAdminClient>["rpc"] };
}) {
  const client = input.supabase ?? createAdminClient();
  const { error } = await client.rpc("write_admin_audit", {
    p_tenant_id: input.tenantId,
    p_action: input.action,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId ?? null,
    p_metadata: input.metadata ?? {},
  });
  if (error) {
    throw new Error(`audit_write_failed:${error.message}`);
  }
}

export type CreateInviteResult =
  | { kind: "membership"; membershipId: string }
  | { kind: "invite"; inviteId: string; emailSent: boolean };

export type CreateCompanyUserResult =
  | { kind: "created"; membershipId: string; userId: string }
  | { kind: "existing"; membershipId: string; userId: string };

export async function createCompanyUser(input: {
  tenantId: string;
  fullName: string;
  email: string;
  password: string;
  role: TenantRole;
  userClient: { rpc: ReturnType<typeof createAdminClient>["rpc"] };
}): Promise<CreateCompanyUserResult> {
  const email = input.email.trim().toLowerCase();
  const existingUserId = await findAuthUserIdByEmail(email);

  if (existingUserId) {
    const { data, error } = await input.userClient.rpc("manage_company_user", {
      p_action: "add",
      p_tenant_id: input.tenantId,
      p_email: email,
      p_membership_id: null,
      p_role: input.role,
    });
    if (error) throw new Error(error.message);
    await writeAudit({
      tenantId: input.tenantId,
      action: "membership.add",
      entityType: "tenant_users",
      entityId: String(data),
      metadata: { email, role: input.role, mode: "existing_user" },
      supabase: input.userClient,
    });
    return { kind: "existing", membershipId: String(data), userId: existingUserId };
  }

  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName.trim() },
  });
  if (createError || !created.user) {
    throw new Error(`auth_user_create_failed:${createError?.message || "unknown"}`);
  }

  let membershipId: string | null = null;
  try {
    const { data, error } = await input.userClient.rpc("manage_company_user", {
      p_action: "add",
      p_tenant_id: input.tenantId,
      p_email: email,
      p_membership_id: null,
      p_role: input.role,
    });
    if (error) throw new Error(error.message);
    membershipId = String(data);
    await writeAudit({
      tenantId: input.tenantId,
      action: "user.create",
      entityType: "tenant_users",
      entityId: membershipId,
      metadata: { email, role: input.role, auth_user_id: created.user.id },
      supabase: input.userClient,
    });
    const { error: pendingInviteError } = await admin
      .from("tenant_invites")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        token_hash: hashInviteToken(`replaced:${created.user.id}:${Date.now()}`),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", input.tenantId)
      .eq("email", email)
      .eq("status", "pending");
    if (pendingInviteError) {
      console.error("pending invite cleanup", pendingInviteError.message);
    }
  } catch (error) {
    if (membershipId) {
      await input.userClient.rpc("manage_company_user", {
        p_action: "remove",
        p_tenant_id: input.tenantId,
        p_email: null,
        p_membership_id: membershipId,
        p_role: null,
      });
    }
    const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);
    if (cleanupError) {
      console.error("company user rollback", cleanupError.message);
    }
    throw error;
  }

  return { kind: "created", membershipId, userId: created.user.id };
}

export async function inviteOrAddCompanyUser(input: {
  tenantId: string;
  email: string;
  role: TenantRole;
  actorUserId: string;
  userClient: { rpc: ReturnType<typeof createAdminClient>["rpc"] };
}): Promise<CreateInviteResult> {
  const email = input.email.trim().toLowerCase();
  const existingUserId = await findAuthUserIdByEmail(email);

  if (existingUserId) {
    const { data, error } = await input.userClient.rpc("manage_company_user", {
      p_action: "add",
      p_tenant_id: input.tenantId,
      p_email: email,
      p_membership_id: null,
      p_role: input.role,
    });
    if (error) throw new Error(error.message);
    await writeAudit({
      tenantId: input.tenantId,
      action: "membership.add",
      entityType: "tenant_users",
      entityId: String(data),
      metadata: { email, role: input.role, mode: "existing_user" },
      supabase: input.userClient,
    });
    return { kind: "membership", membershipId: String(data) };
  }

  const admin = createAdminClient();
  const { token, tokenHash } = createInviteToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: invite, error: insertError } = await admin
    .from("tenant_invites")
    .insert({
      tenant_id: input.tenantId,
      email,
      role: input.role,
      status: "pending",
      token_hash: tokenHash,
      invited_by: input.actorUserId,
      expires_at: expiresAt,
      last_sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !invite) {
    if (/duplicate|unique/i.test(insertError?.message || "")) {
      throw new Error("invite_already_pending");
    }
    throw new Error(insertError?.message || "invite_create_failed");
  }

  // Autorização NÃO usa user_metadata — só token_hash + auth.users.email no accept RPC.
  const redirectTo = inviteAcceptUrl(token);
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
  });

  if (inviteError) {
    await admin
      .from("tenant_invites")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        token_hash: hashInviteToken(`failed:${invite.id}:${Date.now()}`),
        updated_at: new Date().toISOString(),
      })
      .eq("id", invite.id);
    throw new Error(`invite_email_failed:${inviteError.message}`);
  }

  await writeAudit({
    tenantId: input.tenantId,
    action: "invite.create",
    entityType: "tenant_invites",
    entityId: invite.id,
    metadata: {
      email,
      role: input.role,
      email_sent: true,
    },
    supabase: input.userClient,
  });

  return {
    kind: "invite",
    inviteId: invite.id,
    emailSent: true,
  };
}
