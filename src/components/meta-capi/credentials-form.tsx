"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  tenantId: string;
  initialPixelId: string;
  initialTestEventCode: string;
  accessTokenConfigured: boolean;
  initialIsEnabled: boolean;
};

export function MetaCapiCredentialsForm({
  tenantId,
  initialPixelId,
  initialTestEventCode,
  accessTokenConfigured,
  initialIsEnabled,
}: Props) {
  const router = useRouter();
  const [pixelId, setPixelId] = useState(initialPixelId);
  const [accessToken, setAccessToken] = useState("");
  const [testEventCode, setTestEventCode] = useState(initialTestEventCode);
  const [isEnabled, setIsEnabled] = useState(initialIsEnabled);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const res = await fetch("/api/meta-capi/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        pixel_id: pixelId,
        access_token: accessToken || undefined,
        test_event_code: testEventCode || undefined,
        is_enabled: isEnabled,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setLoading(false);

    if (!res.ok) {
      setError(data.error || "Não foi possível salvar a configuração.");
      return;
    }

    setAccessToken("");
    setSuccess(
      "Configuração salva. Use o botão de teste para validar o envio ao Meta.",
    );
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="pixel_id">Pixel ID (Dataset ID)</Label>
        <Input
          id="pixel_id"
          required
          placeholder="123456789012345"
          value={pixelId}
          onChange={(e) => setPixelId(e.target.value)}
          autoComplete="off"
          inputMode="numeric"
        />
        <p className="text-xs text-muted-foreground">
          Encontrado em Events Manager → Data Sources → detalhes do Pixel.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="access_token">Access Token (System User)</Label>
          {accessTokenConfigured ? <Badge>configurado</Badge> : null}
        </div>
        <Input
          id="access_token"
          type="password"
          placeholder={
            accessTokenConfigured
              ? "Deixe em branco para manter o token atual"
              : "Cole o Access Token do System User"
          }
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          autoComplete="new-password"
          required={!accessTokenConfigured}
        />
        <p className="text-xs text-muted-foreground">
          Gere em Business Manager → System Users → Add Assets: Pixel com
          permissão de gravação. O token nunca é retornado ao navegador.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="test_event_code">
          Test Event Code (opcional, Events Manager → Test Events)
        </Label>
        <Input
          id="test_event_code"
          placeholder="TEST12345"
          value={testEventCode}
          onChange={(e) => setTestEventCode(e.target.value)}
          autoComplete="off"
        />
      </div>

      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={isEnabled}
          onChange={(e) => setIsEnabled(e.target.checked)}
        />
        <span>Enviar eventos automaticamente em transições de qualificação</span>
      </label>

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
