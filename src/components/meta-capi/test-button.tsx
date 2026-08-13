"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type TestResult = {
  ok: boolean;
  http_status: number;
  events_received: number | null;
  fbtrace_id: string | null;
  event_id: string;
  error_message: string | null;
};

export function MetaCapiTestButton({ tenantId }: { tenantId: string }) {
  const [testEmail, setTestEmail] = useState("");
  const [testEventCode, setTestEventCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runTest() {
    setLoading(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/meta-capi/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        test_email: testEmail || undefined,
        test_event_code: testEventCode || undefined,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as
      | (TestResult & { error?: string })
      | { error?: string };
    setLoading(false);

    if (!res.ok) {
      setError(("error" in data && data.error) || "Falha ao enviar teste.");
      return;
    }
    setResult(data as TestResult);
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="test_email">Email de teste (opcional)</Label>
          <Input
            id="test_email"
            placeholder="usuario@exemplo.com"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="test_event_code_run">Test Event Code</Label>
          <Input
            id="test_event_code_run"
            placeholder="TEST12345 (opcional, usa o salvo)"
            value={testEventCode}
            onChange={(e) => setTestEventCode(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>
      <Button type="button" onClick={runTest} disabled={loading}>
        <Play className="h-4 w-4" />
        {loading ? "Enviando..." : "Enviar evento de teste"}
      </Button>

      {error ? (
        <p className="rounded-lg alert-error px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            result.ok ? "alert-success" : "alert-error"
          }`}
          role="status"
        >
          <p>
            HTTP {result.http_status}
            {result.events_received != null
              ? ` — events_received: ${result.events_received}`
              : ""}
            {result.fbtrace_id ? ` — fbtrace_id: ${result.fbtrace_id}` : ""}
          </p>
          {result.error_message ? <p>Erro: {result.error_message}</p> : null}
          <p className="text-xs opacity-70">event_id: {result.event_id}</p>
        </div>
      ) : null}
    </div>
  );
}
