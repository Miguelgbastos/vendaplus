"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SetupForm() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const response = await fetch("/api/setup/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_name: companyName, setup_secret: setupSecret }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setLoading(false);
    if (!response.ok) {
      setError(body.error || "Não foi possível concluir a instalação.");
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="companyName">Primeira empresa</Label>
        <Input id="companyName" required minLength={2} value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Nome da empresa" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="setupSecret">Segredo de instalação</Label>
        <Input id="setupSecret" type="password" required autoComplete="off" value={setupSecret} onChange={(event) => setSetupSecret(event.target.value)} />
        <p className="text-xs text-muted-foreground">Use o valor de SETUP_SECRET configurado no deploy.</p>
      </div>
      {error ? <p className="rounded-lg alert-error px-3 py-2 text-sm" role="alert">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={loading}>{loading ? "Instalando..." : "Concluir instalação"}</Button>
    </form>
  );
}
