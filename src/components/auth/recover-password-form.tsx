"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getAppUrl } from "@/lib/env";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RecoverPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${getAppUrl()}/api/auth/callback?next=${encodeURIComponent("/redefinir-senha")}`,
    });
    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground" role="status">
        Se o e-mail existir, você receberá um link para redefinir a senha.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {error ? (
        <p className="rounded-lg alert-error px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Enviando..." : "Enviar link"}
      </Button>
    </form>
  );
}
