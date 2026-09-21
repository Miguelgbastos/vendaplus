import { createHmac } from "node:crypto";
import { decryptSecret, timingSafeEqualString } from "../../crypto.ts";

export const GWE_SIGNATURE_VERSION = "v1";
export const GWE_TIMESTAMP_TOLERANCE_SECONDS = 300;

export class GweSignatureError extends Error {
  readonly code: "missing" | "invalid" | "expired";

  constructor(code: "missing" | "invalid" | "expired") {
    super(code);
    this.name = "GweSignatureError";
    this.code = code;
  }
}

export function parseGweTimestamp(
  value: string | null,
  nowSeconds = Math.floor(Date.now() / 1000),
): number {
  if (!value || !/^\d{1,12}$/.test(value)) {
    throw new GweSignatureError("missing");
  }

  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp)) {
    throw new GweSignatureError("invalid");
  }

  const age = Math.abs(nowSeconds - timestamp);
  if (age > GWE_TIMESTAMP_TOLERANCE_SECONDS) {
    throw new GweSignatureError("expired");
  }
  return timestamp;
}

export function verifyGweSignature(
  rawBody: string,
  timestamp: number,
  signatureHeader: string | null,
  encryptedSecret: string,
): void {
  if (!signatureHeader) throw new GweSignatureError("missing");

  const match = new RegExp(`^${GWE_SIGNATURE_VERSION}=([0-9a-fA-F]{64})$`).exec(
    signatureHeader,
  );
  if (!match) throw new GweSignatureError("invalid");

  const secret = encryptedSecret;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  if (!timingSafeEqualString(match[1], expected)) {
    throw new GweSignatureError("invalid");
  }
}

export async function verifyEncryptedGweSignature(
  rawBody: string,
  timestamp: number,
  signatureHeader: string | null,
  encryptedSecret: string,
): Promise<void> {
  const secret = await decryptSecret(encryptedSecret);
  verifyGweSignature(rawBody, timestamp, signatureHeader, secret);
}
