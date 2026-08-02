"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Building2, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type TenantOption = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

export function TenantSwitcher({
  tenants,
  activeTenantId,
  className,
}: {
  tenants: TenantOption[];
  activeTenantId?: string | null;
  className?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const active =
    tenants.find((t) => t.id === activeTenantId) || tenants[0] || null;

  async function selectTenant(tenantId: string) {
    if (!tenantId || tenantId === activeTenantId || pending) return;
    setError(null);
    setBusyId(tenantId);

    const res = await fetch("/api/tenant/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId }),
    });

    setBusyId(null);

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error || "Não foi possível trocar de empresa.");
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  }

  if (!tenants.length) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        Sem empresa
      </p>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor="tenant-switcher" className="sr-only">
        Empresa ativa
      </label>
      <div className="relative">
        <Building2
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <select
          id="tenant-switcher"
          className="h-9 w-full appearance-none rounded-lg border border-border bg-card pl-8 pr-8 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
          value={active?.id || ""}
          disabled={pending || Boolean(busyId)}
          onChange={(e) => {
            void selectTenant(e.target.value);
          }}
          aria-busy={pending || Boolean(busyId)}
        >
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
          {pending || busyId ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden />
          )}
        </span>
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
