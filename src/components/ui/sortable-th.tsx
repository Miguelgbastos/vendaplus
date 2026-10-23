"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortDirection } from "@/lib/sortable-table";
import { cn } from "@/lib/utils";

export function SortableTh({
  children,
  sortDirection,
  onSort,
  align = "left",
  className,
}: {
  children: ReactNode;
  sortDirection: SortDirection | null;
  onSort: () => void;
  align?: "left" | "right";
  className?: string;
}) {
  const Icon =
    sortDirection === "asc"
      ? ArrowUp
      : sortDirection === "desc"
        ? ArrowDown
        : ArrowUpDown;

  const label =
    typeof children === "string" ? `Ordenar por ${children}` : "Ordenar coluna";

  return (
    <th
      scope="col"
      className={cn(
        "pb-3 font-medium",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      aria-sort={
        sortDirection === "asc"
          ? "ascending"
          : sortDirection === "desc"
            ? "descending"
            : "none"
      }
    >
      <button
        type="button"
        onClick={onSort}
        aria-label={label}
        className={cn(
          "inline-flex max-w-full items-center gap-1 rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          align === "right" && "ml-auto flex-row-reverse",
          sortDirection ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span className="truncate">{children}</span>
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            sortDirection ? "opacity-100" : "opacity-50",
          )}
          aria-hidden
        />
      </button>
    </th>
  );
}
