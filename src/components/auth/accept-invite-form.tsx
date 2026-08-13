"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <p className="text-sm text-muted-foreground">
        Token ausente. Abra o link completo do e-mail de convite.
      </p>
    );
  }

  async function accept() {
    setLoading(true);
    setError(null);
    const response = await fetch("/api/invites/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setLoading(false);
    if (response.status === 401) {
      router.push(`/login?next=${encodeURIComponent(`/convite?token=${token}`)}`);
      return;
    }
    if (!response.ok) {
      setError(body.error || "Não foi possível aceitar o convite.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg alert-error px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="button" className="w-full" disabled={loading} onClick={accept}>
        {loading ? "Aceitando..." : "Aceitar convite"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Precisa autenticar primeiro?{" "}
        <Link
          href={`/login?next=${encodeURIComponent(`/convite?token=${token}`)}`}
          className="text-primary hover:underline"
        >
          Entrar
        </Link>
      </p>
    </div>
  );
}
