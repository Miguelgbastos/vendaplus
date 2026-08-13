/**
 * Currency dos eventos CAPI: um caller manual pode informar a moeda
 * explicitamente; eventos automáticos (CRM) devem herdar a moeda configurada
 * no mapping do tenant, com BRL apenas como último fallback.
 */
export function resolveEventCurrency(
  inputCurrency: string | null | undefined,
  mappingCurrency: string | null | undefined,
): string {
  return inputCurrency || mappingCurrency || "BRL";
}
