const PROXY_URL = process.env.PROXY_URL || "https://para-x402-proxy-production.up.railway.app";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${PROXY_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Proxy request failed: ${res.status}`);
  }
  return data;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${PROXY_URL}${path}`);
  const data = await res.json() as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Proxy request failed: ${res.status}`);
  }
  return data;
}

export interface CreateWalletResult {
  address: string;
  walletId: string;
  userShare: string;
  existing: boolean;
}

export interface CheckWalletResult {
  exists: boolean;
  address?: string;
  walletId?: string;
}

export interface SponsorResult {
  ok: boolean;
  ethTxHash: string;
  usdcTxHash: string;
  ethAmount: string;
  usdcAmount: string;
}

export interface AuthStartResult {
  sessionId: string;
  stage: "verify" | "login";
  urls: Record<string, string>;
}

export interface AuthStatusResult {
  complete: boolean;
  userShare?: string;
  walletId?: string;
  address?: string;
}

export async function createWallet(email: string): Promise<CreateWalletResult> {
  return post("/wallet/create", { email });
}

export async function checkWallet(email: string): Promise<CheckWalletResult> {
  return post("/wallet/check", { email });
}

export async function signTypedData(
  userShare: string,
  walletId: string,
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }
): Promise<`0x${string}`> {
  const result = await post<{ signature: `0x${string}` }>("/wallet/sign-typed-data", {
    userShare,
    walletId,
    typedData,
  });
  return result.signature;
}

export async function requestSponsorship(address: string): Promise<SponsorResult> {
  return post("/sponsor", { address });
}

export async function authStart(email: string): Promise<AuthStartResult> {
  return post("/auth/start", { email });
}

export async function authVerify(sessionId: string, code: string): Promise<{ sessionId: string; stage: string; urls: Record<string, string> }> {
  return post("/auth/verify", { sessionId, code });
}

export async function authStatus(sessionId: string): Promise<AuthStatusResult> {
  return get(`/auth/status/${sessionId}`);
}

export async function healthCheck(): Promise<{ ok: boolean }> {
  return get("/health");
}
