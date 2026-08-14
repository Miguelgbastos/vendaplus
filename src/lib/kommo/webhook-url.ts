export function maskWebhookUrl(value: string): string {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/");
    parts[parts.length - 1] = "••••••••••••";
    return `${url.origin}${parts.join("/")}`;
  } catch {
    return "URL do webhook protegida";
  }
}
