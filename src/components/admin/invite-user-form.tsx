"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TenantRole } from "@/types/database";

const ROLES: TenantRole[] = ["owner", "admin", "analyst", "viewer"];

export function InviteUserForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<TenantRole>("viewer");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("tenant_users").insert({
      tenant_id: tenantId,
      user_id: userId.trim(),
      role,
    });
    setLoading(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setUserId("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-[1fr_160px_auto]">
      <div className="space-y-2">
        <Label htmlFor="userId">UUID do usuário (auth.users / profiles.id)</Label>
        <Input
          id="userId"
          required
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="role">Papel</Label>
        <select
          id="role"
          className="flex h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground"
          value={role}
          onChange={(e) => setRole(e.target.value as TenantRole)}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={loading}>
          {loading ? "Salvando..." : "Adicionar"}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive md:col-span-3">{error}</p> : null}
    </form>
  );
}
