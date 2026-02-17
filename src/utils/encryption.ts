/// <reference lib="dom" />

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "../../.env");

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;

/**
 * Auto-generates a 32-character encryption key and appends it to .env if missing.
 */
export function ensureEncryptionKey(): string {
  const existing = process.env.ENCRYPTION_KEY;
  if (existing && existing.length === 32) return existing;

  // If a key exists but has wrong length, don't overwrite — it may have encrypted data
  if (existing && existing.length > 0) {
    throw new Error(
      `ENCRYPTION_KEY in .env is ${existing.length} chars (expected 32). ` +
      `Changing it would make existing encrypted data unreadable. ` +
      `Fix it manually or delete .keystore.json to start fresh.`
    );
  }

  const key = randomBytes(16).toString("hex"); // 32 hex chars
  const line = `ENCRYPTION_KEY=${key}\n`;

  if (existsSync(ENV_PATH)) {
    const content = readFileSync(ENV_PATH, "utf-8");
    if (content.includes("ENCRYPTION_KEY=")) {
      // Replace placeholder or empty value
      const updated = content.replace(/ENCRYPTION_KEY=.*/, `ENCRYPTION_KEY=${key}`);
      writeFileSync(ENV_PATH, updated);
    } else {
      writeFileSync(ENV_PATH, content + line);
    }
  } else {
    writeFileSync(ENV_PATH, line);
  }

  process.env.ENCRYPTION_KEY = key;
  return key;
}

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 32) {
    return ensureEncryptionKey();
  }
  return key;
}

async function importSecretKey(keyString: string): Promise<CryptoKey> {
  const keyBuffer = Buffer.from(keyString, "utf-8");
  return crypto.subtle.importKey("raw", keyBuffer, { name: ALGORITHM }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encrypt(text: string): Promise<string> {
  const cryptoKey = await importSecretKey(getEncryptionKey());
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(text);

  const encrypted = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, cryptoKey, encoded);

  const ivBase64 = Buffer.from(iv.buffer).toString("base64");
  const encryptedBase64 = Buffer.from(encrypted).toString("base64");

  return `${ivBase64}:${encryptedBase64}`;
}

export async function decrypt(encryptedText: string): Promise<string> {
  const parts = encryptedText.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid encrypted text format. Expected 'IV(base64):Ciphertext(base64)'.");
  }

  const [ivBase64, encryptedBase64] = parts;

  const iv = new Uint8Array(Buffer.from(ivBase64, "base64"));
  const encryptedBuffer = Buffer.from(encryptedBase64, "base64");
  const cryptoKey = await importSecretKey(getEncryptionKey());

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    cryptoKey,
    encryptedBuffer
  );

  return new TextDecoder().decode(decrypted);
}
