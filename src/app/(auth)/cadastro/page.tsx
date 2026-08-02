import { SignupForm } from "@/components/auth/signup-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignupPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(15,118,110,0.08),_transparent_50%)]" />
      <Card className="relative w-full max-w-md border-border bg-card shadow-[var(--shadow-md)]">
        <CardHeader>
          <p className="font-display text-3xl font-semibold text-foreground">
            Venda<span className="text-primary">+</span>
          </p>
          <CardTitle className="pt-2 text-lg">Criar conta</CardTitle>
          <CardDescription>
            Crie sua conta. Empresas e acessos são configurados pelo administrador.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm />
        </CardContent>
      </Card>
    </div>
  );
}
