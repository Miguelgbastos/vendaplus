"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeInternalPath } from "@/lib/safe-redirect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const inviteOnly = searchParams.get("signup") === "invite_only";
  const authError = searchParams.get("error") === "auth";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: signError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (signError) {
      setError(signError.message);
      return;
    }
    const next = safeInternalPath(searchParams.get("next"), "/dashboard");
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {inviteOnly ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground" role="status">
          Após a instalação, o cadastro é somente por convite. Peça acesso ao
          administrador da empresa.
        </p>
      ) : null}
      {authError ? (
        <p className="rounded-lg alert-error px-3 py-2 text-sm" role="alert">
          Não foi possível concluir a autenticação. Tente novamente.
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Senha</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error ? (
        <p className="rounded-lg alert-error px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Entrando..." : "Entrar"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/recuperar-senha" className="text-primary hover:underline">
          Esqueci minha senha
        </Link>
      </p>
      <p className="text-center text-sm text-muted-foreground">
        Acesso inicial?{" "}
        <Link href="/cadastro" className="text-primary hover:underline">
          Criar conta
        </Link>
      </p>
    </form>
  );
}
