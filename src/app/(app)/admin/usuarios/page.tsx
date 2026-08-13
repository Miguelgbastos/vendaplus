import { redirect } from "next/navigation";
import {
  CompanyUsersManager,
  type CompanyInvite,
} from "@/components/admin/company-users-manager";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canManageTenant, getActiveTenant, getUserMemberships, requireUser } from "@/lib/auth";
import { COMPANY_ROLE_LABELS } from "@/lib/company-user-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TenantRole } from "@/types/database";

export default async function UsersAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const { userId, supabase } = await requireUser();
  if (!userId) redirect("/login");
  const memberships = (await getUserMemberships(userId)).filter(
    (item) => item.tenants?.is_active,
  );
  if (!memberships.length) {
    return (
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">Usuários</h1>
        <p className="mt-2 text-muted-foreground">Crie uma empresa primeiro.</p>
      </div>
    );
  }

  const params = await searchParams;
  const selected = await getActiveTenant(userId, params.company || undefined);
  const membership = selected ?? (await getActiveTenant(userId));
  if (!membership) redirect("/configuracoes/empresas");

  const { data: rows, error } = await supabase.rpc("list_company_member_profiles", {
    p_tenant_id: membership.tenant.id,
  });
  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-3xl font-semibold text-foreground">Usuários</h1>
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          Não foi possível carregar os membros desta empresa.
        </p>
      </div>
    );
  }

  type MemberRow = {
    membership_id: string;
    user_id: string;
    role: TenantRole;
    email: string | null;
    full_name: string | null;
  };
  const members = ((rows ?? []) as MemberRow[]).map((row) => ({
    id: row.membership_id,
    userId: row.user_id,
    role: row.role,
    email: row.email,
    fullName: row.full_name,
  }));

  let pendingInvites: CompanyInvite[] = [];
  if (canManageTenant(membership.role)) {
    const admin = createAdminClient();
    const { data: invites } = await admin
      .from("tenant_invites")
      .select("id, email, role, status, expires_at, last_sent_at, created_at")
      .eq("tenant_id", membership.tenant.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(100);
    pendingInvites = (invites ?? []) as CompanyInvite[];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">Usuários</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Convide por e-mail, altere o nível ou remova o acesso. Após o setup, o cadastro aberto fica
          desabilitado.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Empresa</CardTitle>
          <CardDescription>Os acessos abaixo valem somente para a empresa selecionada.</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="flex flex-col gap-3 sm:flex-row">
            <select
              name="company"
              defaultValue={membership.tenant.id}
              className="h-10 min-w-64 rounded-md border border-border bg-card px-3 text-sm text-foreground"
            >
              {memberships.map((item) =>
                item.tenants ? (
                  <option key={item.tenant_id} value={item.tenant_id}>
                    {item.tenants.name}
                  </option>
                ) : null,
              )}
            </select>
            <button
              type="submit"
              className="h-10 rounded-lg bg-secondary px-4 text-sm font-medium text-secondary-foreground"
            >
              Visualizar empresa
            </button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Acessos de {membership.tenant.name}</CardTitle>
          <CardDescription>
            {canManageTenant(membership.role)
              ? "Usuários existentes entram na hora; novos recebem convite por e-mail."
              : "Você pode consultar os usuários, mas não alterar os acessos."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canManageTenant(membership.role) ? (
            <CompanyUsersManager
              companyId={membership.tenant.id}
              actorRole={membership.role}
              members={members}
              pendingInvites={pendingInvites}
            />
          ) : (
            <div className="space-y-3">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-3"
                >
                  <div>
                    <p className="font-medium text-foreground">
                      {member.fullName || member.email || "Usuário"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {member.email || member.userId}
                    </p>
                  </div>
                  <Badge>{COMPANY_ROLE_LABELS[member.role]}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
