import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// A sealed blob carries one participant's Bee CLI config dir between requests.
// It lives only in the browser's memory; the server keeps nothing.
export type SealedSession = {
  slot: string;
  exp: number; // epoch ms
  files: Record<string, string>; // relative path -> base64 contents
};

export const SESSION_TTL_MS = 30 * 60 * 1000;

const AAD = Buffer.from("pollinator-session-v1");
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function parseKey(raw: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("Seal key must be 32 bytes, base64-encoded");
  return key;
}

export function seal(session: SealedSession, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const body = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function unseal(blob: string, key: Buffer, expectedSlot: string, now = Date.now()): SealedSession {
  const raw = Buffer.from(blob, "base64url");
  if (raw.length <= IV_BYTES + TAG_BYTES) throw new SessionError("Malformed session");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
  decipher.setAAD(AAD);
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  let session: SealedSession;
  try {
    const plain = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
    session = JSON.parse(plain.toString("utf8"));
  } catch {
    throw new SessionError("Invalid session");
  }
  if (session.slot !== expectedSlot) throw new SessionError("Session belongs to another participant");
  if (session.exp < now) throw new SessionError("Session expired, connect again");
  return session;
}

export class SessionError extends Error {
  readonly status = 401;
}
