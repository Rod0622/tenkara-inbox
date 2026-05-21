// src/lib/crypto.ts
//
// AES-256-GCM helpers for encrypting integration secrets at rest.
// Format: base64(iv) + ":" + base64(authTag) + ":" + base64(ciphertext)
//
// Requires env var ENCRYPTION_KEY: a 32+ character random string.
// We hash it to a 32-byte key so any length works.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length < 16) {
    throw new Error(
      "ENCRYPTION_KEY env var is missing or too short (need 16+ chars)"
    );
  }
  // Derive a stable 32-byte key from whatever the user provides
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split(":");
  if (parts.length !== 3) return null;
  try {
    const key = getKey();
    const iv = Buffer.from(parts[0], "base64");
    const tag = Buffer.from(parts[1], "base64");
    const ct = Buffer.from(parts[2], "base64");
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  } catch (e: any) {
    // Common cause: ENCRYPTION_KEY changed since the secret was stored
    console.error("[crypto] decryptSecret failed:", e?.message);
    return null;
  }
}

// Mask a stored secret for UI display (e.g. "sk_•••••••abcd")
export function maskSecret(secret: string | null | undefined, visibleTail = 4): string {
  if (!secret) return "";
  if (secret.length <= visibleTail) return "•".repeat(secret.length);
  return "•".repeat(Math.max(8, secret.length - visibleTail)) + secret.slice(-visibleTail);
}
