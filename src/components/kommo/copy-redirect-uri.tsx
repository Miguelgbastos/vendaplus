"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyRedirectUri({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <code className="block flex-1 break-all rounded-md border border-border bg-card px-3 py-2 text-xs text-primary">
        {value}
      </code>
      <Button type="button" variant="secondary" onClick={copy}>
        {copied ? "Copiado" : "Copiar"}
      </Button>
    </div>
  );
}
