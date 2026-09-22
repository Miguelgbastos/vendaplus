"use client";

import { useState } from "react";
import { Copy, Plus, Power, Webhook } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Event = { id: string; external_event_id: string | null; event_type: string | null; received_at: string; processed_at: string | null };
type Connection = {
  id: string; name: string; provider: string; schema_version: number; is_active: boolean;
  endpoint: { endpoint_public_id: string | null; is_active: boolean } | null; events: Event[];
  receivedCount: number; processedCount: number;
};

const PROVIDERS = [["gwe", "GWE / genérico"], ["hubspot", "HubSpot"], ["pipedrive", "Pipedrive"], ["rd_station", "RD Station"], ["generic", "Outro CRM"]] as const;

export function WebhooksManager({ tenantId, appUrl, initialConnections }: { tenantId: string; appUrl: string; initialConnections: Connection[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("gwe");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<{ url: string; keyId: string; secret: string; graceUntil?: string } | null>(null);

  async function createConnection(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError(null);
    const response = await fetch("/api/webhooks/crm/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenant_id: tenantId, name, provider }) });
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) { setError(data.error ?? "Não foi possível criar o webhook."); return; }
    setNewSecret({ url: data.endpoint_url, keyId: data.key_id, secret: data.secret });
    setName(""); setShowForm(false); router.refresh();
  }

  async function rotate(connection: Connection) {
    const response = await fetch("/api/webhooks/crm/connections", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenant_id: tenantId, connection_id: connection.id, action: "rotate_key" }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error ?? "Não foi possível rotacionar a chave."); return; }
    setNewSecret({ url: data.endpoint_url, keyId: data.key_id, secret: data.secret, graceUntil: data.grace_until });
  }

  async function toggle(connection: Connection) {
    const response = await fetch("/api/webhooks/crm/connections", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenant_id: tenantId, connection_id: connection.id, is_active: !connection.is_active }) });
    if (!response.ok) setError("Não foi possível atualizar o status do webhook."); else router.refresh();
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Receba payloads GWE v1 autenticados por HMAC. HubSpot, Pipedrive e RD Station são identificadores do CRM de origem; os adapters nativos ainda não estão incluídos.</p>
        <Button onClick={() => setShowForm((visible) => !visible)}><Plus className="h-4 w-4" /> Novo webhook</Button>
      </div>
      {error ? <p className="rounded-lg alert-error px-3 py-2 text-sm" role="alert">{error}</p> : null}
      {newSecret ? (
        <Card className="border-primary/40">
          <CardHeader><CardTitle>Webhook criado</CardTitle><CardDescription>Copie o segredo agora. Ele não será exibido novamente.</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {newSecret.graceUntil ? <p className="text-muted-foreground">A chave anterior permanece válida até {new Date(newSecret.graceUntil).toLocaleString("pt-BR")}.</p> : null}
            {[["Endpoint", newSecret.url], ["Key ID", newSecret.keyId], ["Signing secret", newSecret.secret]].map(([label, value]) => (
              <div key={label} className="space-y-1"><Label>{label}</Label><div className="flex gap-2"><Input readOnly value={value} type={label === "Signing secret" ? "password" : "text"} /><Button type="button" variant="outline" size="icon" onClick={() => copy(value)} aria-label={`Copiar ${label}`}><Copy className="h-4 w-4" /></Button></div></div>
            ))}
            <Button variant="secondary" onClick={() => setNewSecret(null)}>Fechar</Button>
          </CardContent>
        </Card>
      ) : null}
      {showForm ? (
        <Card><CardHeader><CardTitle>Novo webhook</CardTitle><CardDescription>Crie uma conexão e seu endpoint GWE v1.</CardDescription></CardHeader><CardContent>
          <form onSubmit={createConnection} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="webhook-name">Nome</Label><Input id="webhook-name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="HubSpot Comercial" /></div>
            <div className="space-y-2"><Label htmlFor="webhook-provider">CRM de origem</Label><select id="webhook-provider" className="flex h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" value={provider} onChange={(event) => setProvider(event.target.value)}>{PROVIDERS.map(([value, label]) => <option key={value} value={value}>{label} via GWE v1</option>)}</select><p className="text-xs text-muted-foreground">Esta conexão recebe o contrato GWE v1. A integração direta com o fornecedor será disponibilizada separadamente.</p></div>
            <div className="flex gap-2"><Button type="submit" disabled={loading}>{loading ? "Criando..." : "Criar webhook"}</Button><Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button></div>
          </form>
        </CardContent></Card>
      ) : null}
      {initialConnections.length === 0 ? <Card><CardContent className="flex flex-col items-center gap-3 py-12 text-center"><Webhook className="h-8 w-8 text-primary" /><p className="font-medium">Nenhum webhook configurado</p><p className="text-sm text-muted-foreground">Crie um endpoint para começar a receber snapshots GWE v1.</p></CardContent></Card> : null}
      {initialConnections.map((connection) => (
        <ConnectionCard key={connection.id} appUrl={appUrl} connection={connection} onToggle={() => toggle(connection)} onCopy={copy} onRotate={() => rotate(connection)} />
      ))}
    </div>
  );
}

function ConnectionCard({ appUrl, connection, onToggle, onCopy, onRotate }: { appUrl: string; connection: Connection; onToggle: () => void; onCopy: (value: string) => Promise<void>; onRotate: (connection: Connection) => Promise<void> }) {
  const endpointUrl = connection.endpoint?.endpoint_public_id
    ? `${appUrl}/api/v1/webhooks/crm/${connection.endpoint.endpoint_public_id}`
    : null;
  return (
        <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{connection.name}</CardTitle><CardDescription>{PROVIDERS.find(([value]) => value === connection.provider)?.[1] ?? connection.provider} · GWE v{connection.schema_version}</CardDescription></div><Badge className={connection.is_active ? "border-transparent bg-primary-soft text-primary" : ""}>{connection.is_active ? "Ativo" : "Inativo"}</Badge></div></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-3"><div><p className="text-muted-foreground">Eventos recebidos</p><p className="text-xl font-semibold">{connection.receivedCount}</p></div><div><p className="text-muted-foreground">Último recebimento</p><p>{connection.events[0] ? new Date(connection.events[0].received_at).toLocaleString("pt-BR") : "—"}</p></div><div><p className="text-muted-foreground">Processados</p><p className="text-xl font-semibold">{connection.processedCount}</p></div></div>
            {endpointUrl ? <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{endpointUrl}</p> : null}
            <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={onToggle}><Power className="h-4 w-4" /> {connection.is_active ? "Desativar" : "Ativar"}</Button>{endpointUrl ? <Button variant="ghost" size="sm" onClick={() => onCopy(endpointUrl)}><Copy className="h-4 w-4" /> Copiar endpoint</Button> : null}<Button variant="ghost" size="sm" onClick={() => onRotate(connection)}>Rotacionar chave</Button></div>
            {connection.events.length ? <div className="space-y-2 border-t border-border pt-3"><p className="text-sm font-medium">Eventos recentes</p>{connection.events.slice(0, 5).map((event) => <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-mono text-xs">{event.external_event_id ?? event.id}</span><span className="text-muted-foreground">{event.event_type ?? "lead.snapshot"} · {new Date(event.received_at).toLocaleString("pt-BR")}</span><Badge>{event.processed_at ? "Processado" : "Recebido"}</Badge></div>)}</div> : null}
          </CardContent>
        </Card>
  );
}
