"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  COMPANY_ROLE_LABELS,
  canChangeCompanyMember,
  rolesAssignableBy,
} from "@/lib/company-user-permissions";
import type { TenantRole } from "@/types/database";

type Member = {
  id: string;
  userId: string;
  email: string | null;
  fullName: string | null;
  role: TenantRole;
};

export function CompanyUsersManager({
  companyId,
  actorRole,
  members,
}: {
  companyId: string;
  actorRole: TenantRole;
  members: Member[];
}) {
  const router = useRouter();
  const roles = rolesAssignableBy(actorRole);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TenantRole>("viewer");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function request(method: "POST" | "PATCH" | "DELETE", body: object, key: string) {
    setBusy(key);
    setError(null);
    const response = await fetch("/api/admin/company-users", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, ...body }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!response.ok) {
      setError(result.error || "Não foi possível salvar a alteração.");
      return false;
    }
    router.refresh();
    return true;
  }

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    if (await request("POST", { email, role }, "add")) setEmail("");
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`Remover o acesso de ${member.fullName || member.email || "este usuário"} a esta empresa?`)) return;
    await request("DELETE", { membership_id: member.id }, member.id);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={addMember} className="grid gap-3 md:grid-cols-[1fr_190px_auto]">
        <div className="space-y-2">
          <Label htmlFor="member-email">E-mail do usuário</Label>
          <Input id="member-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="usuario@empresa.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-member-role">Nível de acesso</Label>
          <select id="new-member-role" className="flex h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground" value={role} onChange={(event) => setRole(event.target.value as TenantRole)}>
            {roles.map((item) => <option key={item} value={item}>{COMPANY_ROLE_LABELS[item]}</option>)}
          </select>
        </div>
        <div className="flex items-end"><Button type="submit" disabled={busy !== null}>{busy === "add" ? "Adicionando..." : "Adicionar acesso"}</Button></div>
      </form>

      {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

      <div className="space-y-3">
        {members.map((member) => {
          const editable = canChangeCompanyMember(actorRole, member.role);
          return (
            <div key={member.id} className="flex flex-col gap-3 rounded-lg border border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{member.fullName || member.email || "Usuário"}</p>
                <p className="truncate text-xs text-muted-foreground">{member.email || member.userId}</p>
              </div>
              <div className="flex items-center gap-2">
                {editable ? (
                  <select aria-label={`Nível de acesso de ${member.email || member.userId}`} className="h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground" value={member.role} disabled={busy !== null} onChange={(event) => request("PATCH", { membership_id: member.id, role: event.target.value }, member.id)}>
                    {roles.map((item) => <option key={item} value={item}>{COMPANY_ROLE_LABELS[item]}</option>)}
                  </select>
                ) : <Badge>{COMPANY_ROLE_LABELS[member.role]}</Badge>}
                {editable ? <Button type="button" variant="ghost" size="icon" aria-label={`Remover acesso de ${member.email || member.userId}`} disabled={busy !== null} onClick={() => removeMember(member)}><Trash2 className="size-4" /></Button> : null}
              </div>
            </div>
          );
        })}
        {!members.length ? <p className="text-sm text-muted-foreground">Nenhum usuário possui acesso a esta empresa.</p> : null}
      </div>
    </div>
  );
}
