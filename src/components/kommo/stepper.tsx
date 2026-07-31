"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: 1, label: "Criar integração" },
  { id: 2, label: "Redirect URI" },
  { id: 3, label: "Credenciais" },
  { id: 4, label: "Autorizar" },
];

export function KommoStepper({ current }: { current: number }) {
  return (
    <ol
      className="flex flex-wrap gap-2 md:gap-3"
      aria-label="Progresso do onboarding Kommo"
    >
      {STEPS.map((step) => {
        const done = step.id < current;
        const active = step.id === current;
        return (
          <li
            key={step.id}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-colors",
              active && "border-transparent bg-primary text-primary-foreground shadow-sm",
              done && "border-transparent bg-primary-soft text-primary",
              !active && !done && "border-border bg-card text-muted-foreground",
            )}
            aria-current={active ? "step" : undefined}
          >
            <span
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] tabular-nums",
                active && "bg-primary-foreground/15",
                done && "bg-primary/10",
                !active && !done && "bg-muted",
              )}
            >
              {done ? <Check className="h-3 w-3" aria-hidden /> : step.id}
            </span>
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}
