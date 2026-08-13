import Link from "next/link";
import { RecoverPasswordForm } from "@/components/auth/recover-password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function RecuperarSenhaPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Recuperar senha</CardTitle>
          <CardDescription>
            Enviaremos um link seguro para redefinir sua senha.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RecoverPasswordForm />
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link href="/login" className="text-primary hover:underline">
              Voltar ao login
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
