/**
 * Falha ao descriptografar o access token é um problema transitório/config do
 * nosso lado (ex.: APP_ENCRYPTION_KEY ausente no worker) — deve propagar para
 * o job ser retentado, nunca virar skip `not_configured` com job concluído.
 */
export async function requireDecryptedAccessToken(
  encrypted: string,
  decrypt: (value: string) => Promise<string>,
): Promise<string> {
  try {
    return await decrypt(encrypted);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`meta_capi_token_decrypt_failed:${message}`);
  }
}
