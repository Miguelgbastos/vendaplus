"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignupForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const { data, error: signError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });

    if (signError || !data.user) {
      setLoading(false);
      setError(signError?.message || "Falha no cadastro.");
      return;
    }

    if (tenantName.trim()) {
      const slug = tenantName
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);

      const { data: tenant, error: tenantError } = await supabase
        .from("tenants")
        .insert({
          name: tenantName.trim(),
          slug: slug || `org-${data.user.id.slice(0, 8)}`,
          created_by: data.user.id,
        })
        .select("id")
        .single();

      if (!tenantError && tenant) {
        await supabase.from("tenant_users").insert({
          tenant_id: tenant.id,
          user_id: data.user.id,
          role: "owner",
        });
      }
    }

    setLoading(false);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="fullName">Nome</Label>
        <Input
          id="fullName"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>
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
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="tenantName">Organização (opcional)</Label>
        <Input
          id="tenantName"
          placeholder="Nome da empresa"
          value={tenantName}
          onChange={(e) => setTenantName(e.target.value)}
        />
      </div>
      {error ? (
        <p className="rounded-lg alert-error px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Criando..." : "Criar conta"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Já tem conta?{" "}
        <Link href="/login" className="text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </form>
  );
}
