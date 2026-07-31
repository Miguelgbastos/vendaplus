import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertKommoTokenResponse,
  formatKommoOAuthExchangeError,
  parseExchangeStatusFromLastError,
  redactSensitiveOAuthFragments,
  sanitizeOAuthErrorDetail,
  shouldBlockOAuthRetry,
} from "./oauth-exchange.ts";

const SAMPLE_CODE = "authcode_AbCdEfGhIjKlMnOpQrStUvWxYz0123";
const SAMPLE_SECRET = "clientsecret_9f8e7d6c5b4a3210fedcba98";
const SAMPLE_ACCESS =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepartbase64urlxx";
const SAMPLE_REFRESH = "refresh_token_AaBbCcDdEeFfGgHhIiJjKkLlMmNn";
const SAMPLE_BEARER = "Bearer sk_live_abcdefghijklmnopqrstuvwxyz012345";

describe("sanitizeOAuthErrorDetail", () => {
  it("extrai title de problem+json", () => {
    const detail = sanitizeOAuthErrorDetail(
      JSON.stringify({ title: "Wrong authorization grant", type: "https://example" }),
    );
    assert.equal(detail, "Wrong authorization grant");
  });

  it("sanitiza HTML de nginx sem expor markup", () => {
    const detail = sanitizeOAuthErrorDetail(
      "<html><head></head><body>403 Forbidden</body></html>",
    );
    assert.equal(detail, "403 Forbidden");
  });

  it("redige secrets ecoados em error_description JSON", () => {
    const body = JSON.stringify({
      error: "invalid_grant",
      error_description: `code=${SAMPLE_CODE} client_secret=${SAMPLE_SECRET} access_token=${SAMPLE_ACCESS} refresh_token=${SAMPLE_REFRESH} ${SAMPLE_BEARER}`,
    });
    const detail = sanitizeOAuthErrorDetail(body);
    const formatted = formatKommoOAuthExchangeError(400, body, {
      "content-type": "application/problem+json",
      server: "nginx",
    });

    for (const secret of [
      SAMPLE_CODE,
      SAMPLE_SECRET,
      SAMPLE_ACCESS,
      SAMPLE_REFRESH,
      "sk_live_abcdefghijklmnopqrstuvwxyz012345",
    ]) {
      assert.doesNotMatch(detail, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(
        formatted,
        new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
    assert.match(detail, /invalid_grant|REDACTED/);
    assert.doesNotMatch(formatted, /Bearer sk_live/i);
  });

  it("redige quando só error_description ecoa secrets", () => {
    const body = JSON.stringify({
      error_description: `Denied code=${SAMPLE_CODE} client_secret=${SAMPLE_SECRET} access_token=${SAMPLE_ACCESS} refresh_token=${SAMPLE_REFRESH}`,
    });
    const detail = sanitizeOAuthErrorDetail(body);
    assert.match(detail, /Denied|REDACTED/);
    for (const secret of [SAMPLE_CODE, SAMPLE_SECRET, SAMPLE_ACCESS, SAMPLE_REFRESH]) {
      assert.doesNotMatch(detail, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("redige secrets ecoados em HTML", () => {
    const body = `<html><body>403 Forbidden code=${SAMPLE_CODE} client_secret=${SAMPLE_SECRET} access_token=${SAMPLE_ACCESS} refresh_token=${SAMPLE_REFRESH} ${SAMPLE_BEARER}</body></html>`;
    const detail = sanitizeOAuthErrorDetail(body);
    const formatted = formatKommoOAuthExchangeError(403, body, {
      "content-type": "text/html",
      server: "nginx",
      "cf-ray": "abc123-GRU",
    });

    for (const secret of [
      SAMPLE_CODE,
      SAMPLE_SECRET,
      SAMPLE_ACCESS,
      SAMPLE_REFRESH,
      "sk_live_abcdefghijklmnopqrstuvwxyz012345",
    ]) {
      assert.doesNotMatch(detail, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(
        formatted,
        new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
    assert.match(detail, /403 Forbidden|REDACTED/);
    assert.match(formatted, /server=nginx/);
    assert.match(formatted, /rid=abc123-GRU/);
  });

  it("redige campos JSON code/client_secret/access_token/refresh_token no texto", () => {
    const body = JSON.stringify({
      title: "Denied",
      code: SAMPLE_CODE,
      client_secret: SAMPLE_SECRET,
      access_token: SAMPLE_ACCESS,
      refresh_token: SAMPLE_REFRESH,
    });
    // Quando o parse usa title, o detail curto fica limpo; o format do body
    // via sanitizeOAuthText/redact cobre o caso HTML/plain que ecoa o JSON.
    const fromTitle = sanitizeOAuthErrorDetail(body);
    assert.equal(fromTitle, "Denied");
    assert.doesNotMatch(fromTitle, new RegExp(SAMPLE_CODE));

    const echoed = redactSensitiveOAuthFragments(body);
    for (const secret of [SAMPLE_CODE, SAMPLE_SECRET, SAMPLE_ACCESS, SAMPLE_REFRESH]) {
      assert.doesNotMatch(
        echoed,
        new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
  });
});

describe("formatKommoOAuthExchangeError", () => {
  it("inclui status e cabeçalhos não sensíveis", () => {
    const msg = formatKommoOAuthExchangeError(
      403,
      "<html>Forbidden</html>",
      {
        "content-type": "text/html",
        server: "nginx",
        "cf-ray": "abc123-GRU",
        authorization: "Bearer secret-should-not-appear",
      },
    );
    assert.match(msg, /^kommo_oauth_exchange_403:/);
    assert.match(msg, /ct=text\/html/);
    assert.match(msg, /server=nginx/);
    assert.match(msg, /rid=abc123-GRU/);
    assert.doesNotMatch(msg, /Bearer|secret/i);
  });

  it("preserva x-request-id UUID e CF-Ray longos; ignora Authorization", () => {
    const requestId = "550e8400-e29b-41d4-a716-446655440000";
    const cfRay = "a23e9e85dc9ef217-GRU";
    const msg = formatKommoOAuthExchangeError(
      403,
      "<html>Forbidden</html>",
      {
        "content-type": "text/html",
        server: "nginx",
        "x-request-id": requestId,
        "cf-ray": cfRay,
        authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig",
      },
    );
    // Prefere cf-ray quando ambos existem; garante que IDs longos não viram REDACTED
    assert.match(msg, /rid=a23e9e85dc9ef217-GRU/);
    assert.doesNotMatch(msg, /REDACTED/);
    assert.doesNotMatch(msg, /authorization|Bearer|eyJhbGci/i);

    const onlyUuid = formatKommoOAuthExchangeError(403, "Forbidden", {
      "x-request-id": requestId,
      authorization: "Bearer sk_live_should_never_appear_in_last_error_xx",
    });
    assert.match(onlyUuid, new RegExp(`rid=${requestId}`));
    assert.doesNotMatch(onlyUuid, /Bearer|sk_live|should_never_appear/i);
  });
});

describe("shouldBlockOAuthRetry", () => {
  it("bloqueia 403 recente", () => {
    const now = Date.parse("2026-07-31T18:00:00.000Z");
    assert.equal(
      shouldBlockOAuthRetry({
        lastError: "kommo_oauth_exchange_403:Forbidden|server=nginx",
        updatedAt: "2026-07-31T17:58:00.000Z",
        now,
      }),
      true,
    );
  });

  it("libera após cooldown", () => {
    const now = Date.parse("2026-07-31T18:10:00.000Z");
    assert.equal(
      shouldBlockOAuthRetry({
        lastError: "kommo_oauth_exchange_403:Forbidden",
        updatedAt: "2026-07-31T17:58:00.000Z",
        now,
      }),
      false,
    );
  });

  it("não bloqueia 400", () => {
    assert.equal(
      shouldBlockOAuthRetry({
        lastError: "kommo_oauth_exchange_400:Wrong authorization grant",
        updatedAt: new Date().toISOString(),
      }),
      false,
    );
  });
});

describe("parseExchangeStatusFromLastError", () => {
  it("lê status do prefixo", () => {
    assert.equal(
      parseExchangeStatusFromLastError("kommo_oauth_exchange_429:Too Many Requests"),
      429,
    );
    assert.equal(parseExchangeStatusFromLastError("kommo_oauth_callback_failed"), null);
  });
});

describe("assertKommoTokenResponse", () => {
  it("aceita resposta válida sem decodificar JWT", () => {
    const tokens = assertKommoTokenResponse({
      token_type: "bearer",
      expires_in: 86400,
      access_token: "a".repeat(40),
      refresh_token: "b".repeat(40),
    });
    assert.equal(tokens.expires_in, 86400);
  });

  it("rejeita payload incompleto", () => {
    assert.throws(() => assertKommoTokenResponse({ access_token: "x" }), /invalid/);
  });
});
