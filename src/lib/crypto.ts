import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { webcrypto } from "node:crypto";

const subtle = webcrypto.subtle;

function requireKeyHex(): string {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY deve ter 64 caracteres hexadecimais (32 bytes).",
    );
  }
  return key;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function importAesKey(): Promise<CryptoKey> {
  return subtle.importKey(
    "raw",
    hexToBytes(requireKeyHex()),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Formato: iv_hex:ciphertext_hex (ciphertext inclui auth tag do AES-GCM). */
export async function encryptSecret(plaintext: string): Promise<string> {
  const iv = randomBytes(12);
  const key = await importAesKey();
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );
  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(cipherBuf))}`;
}

export async function decryptSecret(payload: string): Promise<string> {
  const [ivHex, dataHex] = payload.split(":");
  if (!ivHex || !dataHex) {
    throw new Error("Payload criptografado inválido.");
  }
  const key = await importAesKey();
  const plainBuf = await subtle.decrypt(
    { name: "AES-GCM", iv: hexToBytes(ivHex) },
    key,
    hexToBytes(dataHex),
  );
  return new TextDecoder().decode(plainBuf);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export type OAuthStatePayload = {
  tenantId: string;
  userId: string;
  nonce: string;
  exp: number;
};

export type CreatedOAuthState = {
  /** Valor enviado ao provedor OAuth — nunca persistir no banco. */
  state: string;
  stateHash: string;
  nonce: string;
  tenantId: string;
  userId: string;
  expiresAt: string;
};

function requireStateSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("OAUTH_STATE_SECRET não configurado.");
  }
  return secret;
}

export function createOAuthState(
  payload: Omit<OAuthStatePayload, "nonce" | "exp">,
): CreatedOAuthState {
  const full: OAuthStatePayload = {
    ...payload,
    nonce: randomBytes(16).toString("hex"),
    exp: Math.floor(Date.now() / 1000) + 60 * 15,
  };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = createHmac("sha256", requireStateSecret()).update(body).digest("base64url");
  const state = `${body}.${sig}`;
  return {
    state,
    stateHash: sha256Hex(state),
    nonce: full.nonce,
    tenantId: full.tenantId,
    userId: full.userId,
    expiresAt: new Date(full.exp * 1000).toISOString(),
  };
}

export function verifyOAuthState(state: string): OAuthStatePayload {
  const [body, sig] = state.split(".");
  if (!body || !sig) {
    throw new Error("State OAuth inválido.");
  }
  const expected = createHmac("sha256", requireStateSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Assinatura do state OAuth inválida.");
  }
  const payload = JSON.parse(
    Buffer.from(body, "base64url").toString("utf8"),
  ) as OAuthStatePayload;
  if (!payload.tenantId || !payload.userId || !payload.nonce || !payload.exp) {
    throw new Error("State OAuth incompleto.");
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("State OAuth expirado.");
  }
  return payload;
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function randomWebhookToken(): string {
  return randomBytes(32).toString("base64url");
}
