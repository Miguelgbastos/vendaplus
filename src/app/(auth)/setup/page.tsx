import { redirect } from "next/navigation";
import { SetupForm } from "@/components/setup/setup-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { isInstallationComplete } from "@/lib/installation";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const { userId } = await requireUser();
  if (!userId) redirect("/login?next=/setup");

  let installationComplete = false;
  let schemaReady = true;
  try {
    installationComplete = await isInstallationComplete();
  } catch {
    schemaReady = false;
  }
  if (installationComplete) redirect("/dashboard");

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <p className="font-display text-3xl font-semibold">Venda<span className="text-primary">+</span></p>
          <CardTitle>Primeira instalação</CardTitle>
          <CardDescription>Crie a primeira empresa e torne sua conta proprietária. Este fluxo é bloqueado permanentemente após o sucesso.</CardDescription>
        </CardHeader>
        <CardContent>
          {schemaReady ? (
            <SetupForm />
          ) : (
            <p className="rounded-lg alert-error px-3 py-2 text-sm" role="alert">
              Banco ainda não preparado. Aplique as migrations do projeto antes de concluir a instalação.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
