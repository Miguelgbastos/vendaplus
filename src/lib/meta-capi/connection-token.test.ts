import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requireDecryptedAccessToken } from "./connection-token.ts";

describe("requireDecryptedAccessToken", () => {
  it("retorna o token quando o decrypt funciona", async () => {
    const token = await requireDecryptedAccessToken("enc", async () => "plain-token");
    assert.equal(token, "plain-token");
  });

  it("propaga falha de decrypt em vez de engolir (regressão skipped_not_configured)", async () => {
    // Regressão: loadCapiConnection capturava o erro e retornava
    // not_configured, marcando o evento como skip e concluindo o job.
    await assert.rejects(
      requireDecryptedAccessToken("enc", async () => {
        throw new Error("bad key");
      }),
      /meta_capi_token_decrypt_failed:bad key/,
    );
  });

  it("normaliza erros não-Error na mensagem propagada", async () => {
    await assert.rejects(
      requireDecryptedAccessToken("enc", async () => {
        throw "boom";
      }),
      /meta_capi_token_decrypt_failed:boom/,
    );
  });
});
