import Link from "next/link";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/signup-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isInstallationComplete } from "@/lib/installation";

export default async function CadastroPage() {
  let openSignup = true;
  try {
    openSignup = !(await isInstallationComplete());
  } catch {
    // Sem env no build — deixa o formulário tratar.
  }

  if (!openSignup) {
    redirect("/login?signup=invite_only");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Criar conta</CardTitle>
          <CardDescription>
            Cadastro aberto apenas na primeira instalação. Depois, o acesso é
            somente por convite.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm />
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Já tem conta?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Entrar
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
