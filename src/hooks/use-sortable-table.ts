"use client";

import { useMemo, useRef, useState } from "react";
import {
  cycleSortState,
  sortRows,
  type SortAccessor,
  type SortDirection,
  type SortState,
} from "@/lib/sortable-table";

export function useSortableTable<T>(
  rows: readonly T[],
  accessors: Readonly<Record<string, SortAccessor<T>>>,
) {
  const [sort, setSort] = useState<SortState>(null);
  const accessorsRef = useRef(accessors);
  accessorsRef.current = accessors;

  const sortedRows = useMemo(
    () => sortRows(rows, sort, accessorsRef.current),
    [rows, sort],
  );

  function toggle(key: string) {
    setSort((current) => cycleSortState(current, key));
  }

  function headerProps(key: string): {
    sortDirection: SortDirection | null;
    onSort: () => void;
  } {
    return {
      sortDirection: sort?.key === key ? sort.direction : null,
      onSort: () => toggle(key),
    };
  }

  return { rows: sortedRows, sort, headerProps, toggle };
}
