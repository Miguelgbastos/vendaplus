import { AcceptInviteForm } from "@/components/auth/accept-invite-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type SearchParams = Promise<{ token?: string }>;

export default async function ConvitePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Aceitar convite</CardTitle>
          <CardDescription>
            Entre com o mesmo e-mail convidado para ativar o acesso à empresa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AcceptInviteForm token={token} />
        </CardContent>
      </Card>
    </main>
  );
}
