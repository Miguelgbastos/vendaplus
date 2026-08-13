import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(15,118,110,0.08),_transparent_50%)]" />
      <Card className="relative w-full max-w-md border-border bg-card shadow-[var(--shadow-md)]">
        <CardHeader>
          <p className="font-display text-3xl font-semibold text-foreground">
            Venda<span className="text-primary">+</span>
          </p>
          <CardTitle className="pt-2 text-lg">Entrar</CardTitle>
          <CardDescription>
            Acesse dashboards de marketing e comercial conectados ao Kommo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando…</p>}>
            <LoginForm />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
