/// <reference lib="dom" />

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY must be set in your .env file and be exactly 32 characters long."
    );
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
