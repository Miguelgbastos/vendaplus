/**
 * closed_at never invented as now(): prefer Kommo, else previous, else null.
 */
export function resolveClosedAt(input: {
  qualification: string | null | undefined;
  kommoClosedAt: string | null | undefined;
  previousClosedAt: string | null | undefined;
}): string | null {
  const isClosed = input.qualification === "venda" || input.qualification === "perda";
  if (!isClosed) return null;
  return input.kommoClosedAt ?? input.previousClosedAt ?? null;
}
