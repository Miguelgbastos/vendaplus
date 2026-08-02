import { redirect } from "next/navigation";
import { InviteUserForm } from "@/components/admin/invite-user-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canManageTenant, getActiveTenant, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function UsersAdminPage() {
  const { userId } = await requireUser();
  if (!userId) redirect("/login");

  const membership = await getActiveTenant(userId);
  if (!membership) {
    return (
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">
          Usuários
        </h1>
        <p className="mt-2 text-muted-foreground">Selecione ou crie uma empresa primeiro.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: members } = await supabase
    .from("tenant_users")
    .select("id, role, user_id")
    .eq("tenant_id", membership.tenant.id)
    .order("created_at", { ascending: true });

  const userIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, email, full_name").in("id", userIds)
    : { data: [] as Array<{ id: string; email: string | null; full_name: string | null }> };

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">
          Usuários
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Membros de {membership.tenant.name} (proprietário, administrador, analista e leitor).
        </p>
      </div>

      {canManageTenant(membership.role) ? (
        <Card>
          <CardHeader>
            <CardTitle>Adicionar membro</CardTitle>
            <CardDescription>
              Informe o UUID do usuário já cadastrado no Auth.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InviteUserForm tenantId={membership.tenant.id} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Membros</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(members ?? []).map((member) => {
            const profile = profileById.get(member.user_id);
            return (
              <div
                key={member.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-3"
              >
                <div>
                  <p className="font-medium text-foreground">
                    {profile?.full_name || profile?.email || member.user_id}
                  </p>
                  <p className="text-xs text-muted-foreground">{member.user_id}</p>
                </div>
                <Badge>{member.role}</Badge>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
