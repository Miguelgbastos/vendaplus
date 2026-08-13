/** Paths relativos seguros para a API Kommo do subdomínio do tenant. */
export function buildKommoApiUrl(subdomain: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    throw new Error("kommo_absolute_url_forbidden");
  }
  if (path.includes("..") || path.includes("\\") || path.includes("\0")) {
    throw new Error("kommo_path_traversal_forbidden");
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!normalized.startsWith("/api/")) {
    throw new Error("kommo_path_not_allowed");
  }
  return `https://${subdomain}.kommo.com${normalized}`;
}
