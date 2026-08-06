"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DashboardFilterOptions } from "@/lib/dashboard-filter-options";
import {
  serializeDashboardFilters,
  type DashboardFilters,
} from "@/lib/dashboard-filters";

const ALL_VALUE = "__all__";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Props = {
  filters: DashboardFilters;
  options: DashboardFilterOptions;
  clamped?: boolean;
};

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string | undefined;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string | undefined) => void;
}) {
  return (
    <div className="w-full min-w-[160px] sm:w-auto sm:min-w-[160px] sm:flex-1 lg:flex-none lg:w-44">
      <Label htmlFor={id} className="mb-1.5 block">
        {label}
      </Label>
      <Select
        value={value ?? ALL_VALUE}
        onValueChange={(next) =>
          onChange(next === ALL_VALUE ? undefined : next)
        }
      >
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue placeholder="Todos" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>Todos</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function DashboardFiltersBar({
  filters,
  options,
  clamped = false,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const committedRef = useRef({ from: filters.from, to: filters.to });

  useEffect(() => {
    setFrom(filters.from);
    setTo(filters.to);
    committedRef.current = { from: filters.from, to: filters.to };
  }, [filters.from, filters.to]);

  function pushFilters(next: DashboardFilters) {
    const params = serializeDashboardFilters(next);
    const qs = params.toString();
    const href = qs ? `${pathname}?${qs}` : pathname;
    startTransition(() => {
      router.replace(href, { scroll: false });
    });
  }

  function patch(partial: Partial<DashboardFilters>) {
    const next: DashboardFilters = {
      from: partial.from ?? filters.from,
      to: partial.to ?? filters.to,
    };
    const campaign =
      "campaign" in partial ? partial.campaign : filters.campaign;
    const source = "source" in partial ? partial.source : filters.source;
    const medium = "medium" in partial ? partial.medium : filters.medium;
    const owner = "owner" in partial ? partial.owner : filters.owner;
    const stage = "stage" in partial ? partial.stage : filters.stage;
    if (campaign) next.campaign = campaign;
    if (source) next.source = source;
    if (medium) next.medium = medium;
    if (owner) next.owner = owner;
    if (stage) next.stage = stage;
    pushFilters(next);
  }

  function clear() {
    startTransition(() => {
      router.replace(pathname, { scroll: false });
    });
  }

  function commitDate(key: "from" | "to", value: string) {
    if (!DATE_RE.test(value)) return;
    if (committedRef.current[key] === value) return;
    committedRef.current = { ...committedRef.current, [key]: value };
    patch({ [key]: value });
  }

  function onDateChange(key: "from" | "to", value: string) {
    // WebKit can emit empty values while the picker is open; ignore those.
    if (!value) return;
    // Keep draft local so the native picker doesn't snap back while RSC navigates.
    if (key === "from") setFrom(value);
    else setTo(value);
    commitDate(key, value);
  }

  function onDateBlur(key: "from" | "to", value: string) {
    if (DATE_RE.test(value)) {
      commitDate(key, value);
      return;
    }
    if (key === "from") setFrom(filters.from);
    else setTo(filters.to);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/80 bg-card/60 p-3 sm:p-4">
        <div className="flex w-full flex-wrap gap-3 sm:w-auto">
          <div className="w-full min-w-[140px] sm:w-36">
            <Label htmlFor="filter-from" className="mb-1.5 block">
              De
            </Label>
            <Input
              id="filter-from"
              type="date"
              aria-label="Data inicial"
              value={from}
              onChange={(event) => onDateChange("from", event.target.value)}
              onInput={(event) =>
                onDateChange("from", (event.target as HTMLInputElement).value)
              }
              onBlur={(event) => onDateBlur("from", event.target.value)}
            />
          </div>
          <div className="w-full min-w-[140px] sm:w-36">
            <Label htmlFor="filter-to" className="mb-1.5 block">
              Até
            </Label>
            <Input
              id="filter-to"
              type="date"
              aria-label="Data final"
              value={to}
              onChange={(event) => onDateChange("to", event.target.value)}
              onInput={(event) =>
                onDateChange("to", (event.target as HTMLInputElement).value)
              }
              onBlur={(event) => onDateBlur("to", event.target.value)}
            />
          </div>
        </div>

        <FilterSelect
          id="filter-campaign"
          label="Campanha"
          value={filters.campaign}
          options={options.campaigns}
          onChange={(campaign) => patch({ campaign })}
        />
        <FilterSelect
          id="filter-source"
          label="Origem"
          value={filters.source}
          options={options.sources}
          onChange={(source) => patch({ source })}
        />
        <FilterSelect
          id="filter-medium"
          label="Mídia"
          value={filters.medium}
          options={options.media}
          onChange={(medium) => patch({ medium })}
        />
        <FilterSelect
          id="filter-owner"
          label="Responsável"
          value={filters.owner}
          options={options.owners}
          onChange={(owner) => patch({ owner })}
        />
        <FilterSelect
          id="filter-stage"
          label="Etapa"
          value={filters.stage}
          options={options.stages}
          onChange={(stage) =>
            patch({
              stage: stage as DashboardFilters["stage"] | undefined,
            })
          }
        />

        <Button
          type="button"
          variant="outline"
          className="w-full sm:ml-auto sm:w-auto"
          onClick={clear}
        >
          Limpar filtros
        </Button>
      </div>
      {clamped ? (
        <p className="text-xs text-muted-foreground">
          Período limitado a 90 dias.
        </p>
      ) : null}
    </div>
  );
}
