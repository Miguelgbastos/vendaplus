import { redirect } from "next/navigation";
import { CreateTenantForm } from "@/components/admin/create-tenant-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getUserMemberships, requireUser } from "@/lib/auth";

export default async function CompaniesAdminPage() {
  const { userId } = await requireUser();
  if (!userId) redirect("/login");

  const memberships = await getUserMemberships(userId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">
          Empresas
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Empresas às quais você pertence e criação de novas.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Criar empresa</CardTitle>
          <CardDescription>Você será proprietário da nova empresa.</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateTenantForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Minhas empresas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!memberships.length ? (
            <p className="text-sm text-muted-foreground">Nenhuma empresa ainda.</p>
          ) : (
            memberships.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-3"
              >
                <div>
                  <p className="font-medium text-foreground">
                    {m.tenants?.name || "Empresa"}
                  </p>
                  <p className="text-xs text-muted-foreground">{m.tenants?.slug}</p>
                </div>
                <Badge>{m.role}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
