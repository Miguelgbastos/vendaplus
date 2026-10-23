export type SortDirection = "asc" | "desc";

export type SortColumnType =
  | "text"
  | "number"
  | "percent"
  | "currency"
  | "date"
  | "datetime"
  | "boolean";

export type SortValue = string | number | boolean | Date | null | undefined;

export type SortState = {
  key: string;
  direction: SortDirection;
} | null;

export type SortAccessor<T> = {
  type: SortColumnType;
  value: (row: T) => SortValue;
};

/** none → asc → desc → none */
export function cycleSortState(current: SortState, key: string): SortState {
  if (!current || current.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return null;
}

function toComparable(
  value: SortValue,
  type: SortColumnType,
): string | number | boolean | null {
  if (value == null) return null;
  switch (type) {
    case "text":
      return String(value);
    case "number":
    case "percent":
    case "currency": {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case "date":
    case "datetime": {
      if (value instanceof Date) {
        const t = value.getTime();
        return Number.isFinite(t) ? t : null;
      }
      const t = new Date(String(value)).getTime();
      return Number.isFinite(t) ? t : null;
    }
    case "boolean":
      return Boolean(value);
    default:
      return String(value);
  }
}

export function compareSortValues(
  left: SortValue,
  right: SortValue,
  type: SortColumnType,
  direction: SortDirection,
): number {
  const a = toComparable(left, type);
  const b = toComparable(right, type);
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  let result = 0;
  if (type === "text") {
    result = String(a).localeCompare(String(b), "pt-BR", { sensitivity: "base" });
  } else if (typeof a === "boolean" && typeof b === "boolean") {
    result = Number(a) - Number(b);
  } else {
    result = (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
  }

  return direction === "asc" ? result : -result;
}

export function sortRows<T>(
  rows: readonly T[],
  sort: SortState,
  accessors: Readonly<Record<string, SortAccessor<T>>>,
): T[] {
  if (!sort) return [...rows];
  const accessor = accessors[sort.key];
  if (!accessor) return [...rows];

  // Desempate determinístico pelo índice original: mantém a ordem estável entre
  // linhas iguais em qualquer engine e evita "pulos" ao alternar a ordenação.
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const result = compareSortValues(
        accessor.value(left.row),
        accessor.value(right.row),
        accessor.type,
        sort.direction,
      );
      return result !== 0 ? result : left.index - right.index;
    })
    .map((entry) => entry.row);
}
