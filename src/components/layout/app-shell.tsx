"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Building2,
  Link2,
  LogOut,
  Megaphone,
  LayoutDashboard,
  Users,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  TenantSwitcher,
  type TenantOption,
} from "@/components/layout/tenant-switcher";

const NAV = [
  { href: "/dashboard", label: "Geral", icon: LayoutDashboard },
  { href: "/dashboard/marketing", label: "Marketing", icon: Megaphone },
  { href: "/dashboard/comercial", label: "Comercial", icon: BarChart3 },
  { href: "/kommo", label: "Kommo", icon: Link2 },
  { href: "/admin/tenants", label: "Tenants", icon: Building2 },
  { href: "/admin/usuarios", label: "Usuários", icon: Users },
];

function NavLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-1 flex-col gap-1">
      {NAV.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(item.href));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-sidebar-active font-medium text-sidebar-active-foreground"
                : "text-sidebar-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({
  children,
  tenantName,
  activeTenantId,
  tenants,
  userEmail,
}: {
  children: React.ReactNode;
  tenantName?: string | null;
  activeTenantId?: string | null;
  tenants?: TenantOption[];
  userEmail?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const options = tenants ?? [];

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-[1440px]">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-6 md:flex">
          <div className="mb-6 px-2">
            <p className="font-display text-2xl font-semibold tracking-tight text-foreground">
              Venda<span className="text-primary">+</span>
            </p>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {tenantName || "Sem organização"}
            </p>
          </div>
          <div className="mb-6 px-0">
            <TenantSwitcher
              tenants={options}
              activeTenantId={activeTenantId}
            />
          </div>
          <NavLinks pathname={pathname} />
          <div className="mt-auto space-y-3 border-t border-sidebar-border pt-4">
            <p className="truncate px-2 text-xs text-muted-foreground">{userEmail}</p>
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={signOut}
            >
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 md:hidden">
            <div className="min-w-0">
              <p className="font-display text-lg font-semibold">
                Venda<span className="text-primary">+</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {tenantName || "Sem organização"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={open ? "Fechar menu" : "Abrir menu"}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </header>
          {open ? (
            <div className="space-y-4 border-b border-border bg-card px-4 py-4 md:hidden">
              <TenantSwitcher
                tenants={options}
                activeTenantId={activeTenantId}
              />
              <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={signOut}
              >
                <LogOut className="h-4 w-4" />
                Sair
              </Button>
            </div>
          ) : null}
          <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
