import Link from "next/link";
import { Building2, Database, Link2, Users } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SECTIONS = [
  { href: "/configuracoes/supabase", title: "Supabase", description: "Status da infraestrutura, chaves e segurança.", icon: Database },
  { href: "/configuracoes/kommo", title: "Kommo", description: "Credenciais e conexão da empresa ativa.", icon: Link2 },
  { href: "/configuracoes/usuarios", title: "Usuários", description: "Membros e permissões da empresa ativa.", icon: Users },
  { href: "/configuracoes/empresas", title: "Empresas", description: "Empresas disponíveis e empresa ativa.", icon: Building2 },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Configurações</h1>
        <p className="mt-1 text-sm text-muted-foreground">Administre a infraestrutura e o acesso ao Venda+.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map(({ href, title, description, icon: Icon }) => (
          <Link href={href} key={href}>
            <Card className="h-full transition-colors hover:border-primary/40">
              <CardHeader>
                <Icon className="mb-2 h-5 w-5 text-primary" />
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
