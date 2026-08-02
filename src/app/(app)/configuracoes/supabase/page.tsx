import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabaseUrl, hasSupabasePublicConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function SupabaseSettingsPage() {
  const publicReady = hasSupabasePublicConfig();
  const serverReady = Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  const projectHost = publicReady ? new URL(getSupabaseUrl()).host : "não configurado";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Supabase</h1>
        <p className="mt-1 text-sm text-muted-foreground">Diagnóstico somente leitura. Segredos nunca são exibidos ou editados aqui.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Status</CardTitle><CardDescription>Configuração carregada pelo ambiente do deploy.</CardDescription></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="flex items-center justify-between"><span>Projeto</span><span className="font-mono text-xs">{projectHost}</span></p>
          <p className="flex items-center justify-between"><span>Chave pública</span><Badge>{publicReady ? "configurada" : "ausente"}</Badge></p>
          <p className="flex items-center justify-between"><span>Chave secreta do servidor</span><Badge>{serverReady ? "configurada" : "ausente"}</Badge></p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Por que não editar pela interface?</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>A chave pública do navegador é definida no build do Next.js. Alterá-la depois exige reconstruir a aplicação ou introduzir uma camada própria de configuração em runtime.</p>
          <p>A chave secreta ignora RLS e deve ficar no cofre de segredos do host. Arquivos locais não são confiáveis em deploys com múltiplas instâncias ou disco efêmero.</p>
        </CardContent>
      </Card>
    </div>
  );
}
