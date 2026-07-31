"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type Props = {
  tenantId: string;
  initialSubdomain: string;
  initialIntegrationId: string;
  secretConfigured: boolean;
};

export function KommoCredentialsForm({
  tenantId,
  initialSubdomain,
  initialIntegrationId,
  secretConfigured,
}: Props) {
  const router = useRouter();
  const [subdomain, setSubdomain] = useState(initialSubdomain);
  const [integrationId, setIntegrationId] = useState(initialIntegrationId);
  const [clientSecret, setClientSecret] = useState("");
  const [longLivedToken, setLongLivedToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const res = await fetch("/api/kommo/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        subdomain,
        integration_id: integrationId,
        client_secret: clientSecret || undefined,
        long_lived_token: longLivedToken || undefined,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Não foi possível salvar a configuração.");
      return;
    }

    setClientSecret("");
    setLongLivedToken("");
    setSuccess(
      longLivedToken
        ? "Token validado e conexão Kommo concluída."
        : "Configuração salva. Você já pode autorizar no Kommo.",
    );
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="subdomain">Subdomínio</Label>
        <Input
          id="subdomain"
          required
          placeholder="minhaempresa ou minhaempresa.kommo.com"
          value={subdomain}
          onChange={(e) => setSubdomain(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="long_lived_token">Token de longa duração (alternativa ao OAuth)</Label>
        <Input
          id="long_lived_token"
          type="password"
          placeholder="Cole o token gerado no Kommo"
          value={longLivedToken}
          onChange={(e) => setLongLivedToken(e.target.value)}
          autoComplete="new-password"
        />
        <p className="text-xs text-muted-foreground">
          Use quando a hospedagem bloquear a troca OAuth. O token é validado e armazenado criptografado.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="integration_id">Integration ID</Label>
        <Input
          id="integration_id"
          required
          placeholder="Cole o Integration ID da integração privada"
          value={integrationId}
          onChange={(e) => setIntegrationId(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="client_secret">Secret Key</Label>
          {secretConfigured ? <Badge>configurado</Badge> : null}
        </div>
        <Input
          id="client_secret"
          type="password"
          placeholder={
            secretConfigured
              ? "Deixe em branco para manter o secret atual"
              : "Cole a Secret Key"
          }
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          autoComplete="new-password"
          required={!secretConfigured}
        />
        <p className="text-xs text-muted-foreground">
          O secret nunca é exibido depois de salvo. Em edições, campo vazio preserva o valor atual.
        </p>
      </div>
      {error ? (
        <p className="rounded-lg alert-error px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-lg alert-success px-3 py-2 text-sm" role="status">
          {success}
        </p>
      ) : null}
      <Button type="submit" disabled={loading}>
        {loading ? "Salvando..." : "Salvar configuração"}
      </Button>
    </form>
  );
}
