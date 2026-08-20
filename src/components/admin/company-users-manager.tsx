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

export type CompanyInvite = {
  id: string;
  email: string;
  role: TenantRole;
  status: string;
  expires_at: string;
  last_sent_at: string;
  created_at: string;
};

export function CompanyUsersManager({
  companyId,
  actorRole,
  members,
  pendingInvites = [],
}: {
  companyId: string;
  actorRole: TenantRole;
  members: Member[];
  pendingInvites?: CompanyInvite[];
}) {
  const router = useRouter();
  const roles = rolesAssignableBy(actorRole);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<TenantRole>("viewer");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function request(method: "POST" | "PATCH" | "DELETE", body: object, key: string) {
    setBusy(key);
    setError(null);
    setInfo(null);
    const response = await fetch("/api/admin/company-users", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, ...body }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      mode?: string;
    };
    setBusy(null);
    if (!response.ok) {
      setError(result.error || "Não foi possível salvar a alteração.");
      return false;
    }
    if (method === "POST") {
      setInfo(
        result.mode === "existing"
          ? "Usuário existente vinculado à empresa. A senha atual foi preservada."
          : "Usuário criado e vinculado à empresa. Ele já pode entrar com o e-mail e a senha definidos.",
      );
    } else if (method === "PATCH") {
      setInfo("Nível de acesso atualizado.");
    } else {
      setInfo("Acesso removido da empresa.");
    }
    router.refresh();
    return true;
  }

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    if (await request("POST", { full_name: fullName, email, password, role }, "add")) {
      setFullName("");
      setEmail("");
      setPassword("");
    }
  }

  async function removeMember(member: Member) {
    if (
      !window.confirm(
        `Remover o acesso de ${member.fullName || member.email || "este usuário"} a esta empresa?`,
      )
    ) {
      return;
    }
    await request("DELETE", { membership_id: member.id }, member.id);
  }

  async function resendInvite(inviteId: string) {
    setBusy(`invite-${inviteId}`);
    setError(null);
    const response = await fetch("/api/admin/company-invites", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, invite_id: inviteId }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!response.ok) {
      setError(result.error || "Falha ao reenviar.");
      return;
    }
    setInfo("Convite reenviado.");
    router.refresh();
  }

  async function cancelInvite(inviteId: string) {
    setBusy(`cancel-${inviteId}`);
    setError(null);
    const response = await fetch("/api/admin/company-invites", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, invite_id: inviteId }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!response.ok) {
      setError(result.error || "Falha ao cancelar.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={addMember} className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="member-name">Nome</Label>
          <Input
            id="member-name"
            autoComplete="name"
            required
            minLength={2}
            maxLength={120}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Nome completo"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="member-email">E-mail do usuário</Label>
          <Input
            id="member-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="usuario@empresa.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="member-password">Senha inicial</Label>
          <Input
            id="member-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-member-role">Nível de acesso</Label>
          <select
            id="new-member-role"
            className="flex h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground"
            value={role}
            onChange={(event) => setRole(event.target.value as TenantRole)}
          >
            {roles.map((item) => (
              <option key={item} value={item}>
                {COMPANY_ROLE_LABELS[item]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={busy !== null}>
            {busy === "add" ? "Criando..." : "Criar usuário"}
          </Button>
        </div>
      </form>

      {error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {info ? (
        <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          {info}
        </p>
      ) : null}

      {pendingInvites.length ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Convites pendentes</h3>
          {pendingInvites.map((invite) => (
            <div
              key={invite.id}
              className="flex flex-col gap-3 rounded-lg border border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{invite.email}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {COMPANY_ROLE_LABELS[invite.role]} · expira{" "}
                  {new Date(invite.expires_at).toLocaleString("pt-BR")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge>Pendente</Badge>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => resendInvite(invite.id)}
                >
                  Reenviar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => cancelInvite(invite.id)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Membros</h3>
        {members.map((member) => {
          const editable = canChangeCompanyMember(actorRole, member.role);
          return (
            <div
              key={member.id}
              className="flex flex-col gap-3 rounded-lg border border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {member.fullName || member.email || "Usuário"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.email || member.userId}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {editable ? (
                  <select
                    aria-label={`Nível de acesso de ${member.email || member.userId}`}
                    className="h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground"
                    value={member.role}
                    disabled={busy !== null}
                    onChange={(event) =>
                      request(
                        "PATCH",
                        { membership_id: member.id, role: event.target.value },
                        member.id,
                      )
                    }
                  >
                    {roles.map((item) => (
                      <option key={item} value={item}>
                        {COMPANY_ROLE_LABELS[item]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge>{COMPANY_ROLE_LABELS[member.role]}</Badge>
                )}
                {editable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busy !== null}
                    onClick={() => removeMember(member)}
                    aria-label="Remover acesso"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
