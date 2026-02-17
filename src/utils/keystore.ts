import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYSTORE_PATH = resolve(__dirname, "../../.keystore.json");

export interface WalletEntry {
  encryptedShare: string;
  walletId: string;
  address: string;
  email: string;
  createdAt: string;
}

type KeyStore = Record<string, WalletEntry>;

function loadStore(): KeyStore {
  if (!existsSync(KEYSTORE_PATH)) return {};
  try {
    const raw = JSON.parse(readFileSync(KEYSTORE_PATH, "utf-8"));
    // Migrate old format (email → encryptedShare string) to new format
    const store: KeyStore = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string") {
        // Old format — just an encrypted share string, skip (can't migrate without walletId)
        continue;
      }
      store[key] = value as WalletEntry;
    }
    return store;
  } catch {
    return {};
  }
}

function saveStore(store: KeyStore): void {
  writeFileSync(KEYSTORE_PATH, JSON.stringify(store, null, 2), { mode: 0o600 });
}

export async function getKeyShare(email: string): Promise<string | null> {
  const store = loadStore();
  return store[email]?.encryptedShare ?? null;
}

export async function getStoredWallet(email: string): Promise<WalletEntry | null> {
  const store = loadStore();
  return store[email] ?? null;
}

export async function setWallet(entry: WalletEntry): Promise<void> {
  const store = loadStore();
  store[entry.email] = entry;
  saveStore(store);
}

/** Backwards-compatible alias */
export async function setKeyShare(email: string, encryptedKeyShare: string): Promise<void> {
  const store = loadStore();
  if (store[email]) {
    store[email].encryptedShare = encryptedKeyShare;
  } else {
    store[email] = {
      encryptedShare: encryptedKeyShare,
      walletId: "",
      address: "",
      email,
      createdAt: new Date().toISOString(),
    };
  }
  saveStore(store);
}

export async function listWallets(): Promise<WalletEntry[]> {
  const store = loadStore();
  return Object.values(store);
}
