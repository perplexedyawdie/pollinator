import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { seal, unseal, SessionError } from "../src/core/seal.js";

const key = randomBytes(32);
const session = { slot: "a", exp: Date.now() + 60_000, files: { "pairing-prod.json": Buffer.from("{}").toString("base64") } };

test("round trip", () => {
  assert.deepEqual(unseal(seal(session, key), key, "a"), session);
});

test("rejects the other slot", () => {
  assert.throws(() => unseal(seal(session, key), key, "b"), SessionError);
});

test("rejects expired sessions", () => {
  assert.throws(() => unseal(seal(session, key), key, "a", session.exp + 1), /expired/);
});

test("rejects tampering and wrong keys", () => {
  const blob = seal(session, key);
  const bytes = Buffer.from(blob, "base64url");
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => unseal(bytes.toString("base64url"), key, "a"), SessionError);
  assert.throws(() => unseal(blob, randomBytes(32), "a"), SessionError);
});
