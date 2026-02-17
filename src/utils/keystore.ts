import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYSTORE_PATH = resolve(__dirname, "../../.keystore.json");

type KeyStore = Record<string, string>;

function loadStore(): KeyStore {
  if (!existsSync(KEYSTORE_PATH)) {
    return {};
  }
  return JSON.parse(readFileSync(KEYSTORE_PATH, "utf-8"));
}

function saveStore(store: KeyStore): void {
  writeFileSync(KEYSTORE_PATH, JSON.stringify(store, null, 2));
}

export async function getKeyShare(email: string): Promise<string | null> {
  const store = loadStore();
  return store[email] ?? null;
}

export async function setKeyShare(email: string, encryptedKeyShare: string): Promise<void> {
  const store = loadStore();
  store[email] = encryptedKeyShare;
  saveStore(store);
}
