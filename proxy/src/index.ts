import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Para as ParaServer, Environment } from "@getpara/server-sdk";
import {
  hashTypedData,
  parseSignature,
  serializeSignature,
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseUnits,
  type Hex,
} from "viem";
import { base } from "viem/chains";

// ── Config ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "8787");
const PARA_API_KEY = process.env.PARA_API_KEY!;
const SPONSOR_PRIVATE_KEY = process.env.SPONSOR_PRIVATE_KEY;

if (!PARA_API_KEY) {
  console.error("PARA_API_KEY is required");
  process.exit(1);
}

const BASE_RPC = "https://mainnet.base.org";
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const FREE_TIER_LIMIT = 100;
const SPONSOR_ETH_AMOUNT = "0.0005";

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ── In-Memory Storage (replaces CF KV) ──────────────────────────────────────

const usageStore = new Map<string, { operations: number; lastUsed: string }>();
const sponsorStore = new Map<string, { ethTxHash: string; usdcTxHash: string; sponsoredAt: string }>();
const authSessions = new Map<string, { data: string; expiresAt: number }>();

// Clean expired auth sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of authSessions) {
    if (session.expiresAt < now) authSessions.delete(key);
  }
}, 5 * 60 * 1000);

// ── Helpers ─────────────────────────────────────────────────────────────────

function hexStringToBase64(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  return Buffer.from(bytes).toString("base64");
}

function normalizeSignature(rawSignature: string): Hex {
  const sigHex = (rawSignature.startsWith("0x") ? rawSignature : `0x${rawSignature}`) as Hex;
  const parsed = parseSignature(sigHex);
  return serializeSignature({ r: parsed.r, s: parsed.s, yParity: parsed.yParity });
}

function createPara(): ParaServer {
  return new ParaServer(Environment.BETA, PARA_API_KEY);
}

// ── Free Tier Tracking ──────────────────────────────────────────────────────

function checkFreeTier(identity: string): { allowed: boolean; used: number } {
  const key = identity.toLowerCase();
  const data = usageStore.get(key);
  const used = data?.operations ?? 0;
  return { allowed: used < FREE_TIER_LIMIT, used };
}

function recordUsage(identity: string): void {
  const key = identity.toLowerCase();
  const data = usageStore.get(key);
  const ops = (data?.operations ?? 0) + 1;
  usageStore.set(key, { operations: ops, lastUsed: new Date().toISOString() });
}

// ── App ─────────────────────────────────────────────────────────────────────

const app = new Hono();

// Health check
app.get("/health", (c) => {
  return c.json({ ok: true, version: "1.0.0", timestamp: new Date().toISOString() });
});

// ── Wallet Routes ───────────────────────────────────────────────────────────

app.post("/wallet/create", async (c) => {
  const { email } = await c.req.json<{ email: string }>();
  if (!email) return c.json({ error: "email is required" }, 400);

  const para = createPara();

  const exists = await para.hasPregenWallet({ pregenId: { email } });
  if (exists) {
    try {
      await para.createPregenWalletPerType({ types: ["EVM"], pregenId: { email } });
    } catch {
      return c.json({ error: "Failed to load existing wallet. Try again." }, 500);
    }
    const walletId = para.findWalletId(undefined, { type: ["EVM"] });
    const wallet = para.wallets[walletId];
    if (!wallet?.address) {
      return c.json({ error: "Wallet exists but could not be loaded" }, 500);
    }
    const userShare = para.getUserShare();
    return c.json({ address: wallet.address, walletId, userShare, existing: true });
  }

  await para.createPregenWalletPerType({ types: ["EVM"], pregenId: { email } });

  const walletId = para.findWalletId(undefined, { type: ["EVM"] });
  const wallet = para.wallets[walletId];
  const userShare = para.getUserShare();

  if (!userShare) {
    return c.json({ error: "Failed to get user share after wallet creation" }, 500);
  }

  return c.json({ address: wallet.address, walletId, userShare, existing: false });
});

app.post("/wallet/check", async (c) => {
  const { email } = await c.req.json<{ email: string }>();
  if (!email) return c.json({ error: "email is required" }, 400);

  const para = createPara();
  const exists = await para.hasPregenWallet({ pregenId: { email } });

  if (!exists) return c.json({ exists: false });

  try {
    await para.createPregenWalletPerType({ types: ["EVM"], pregenId: { email } });
  } catch {
    return c.json({ exists: true });
  }
  const walletId = para.findWalletId(undefined, { type: ["EVM"] });
  const wallet = para.wallets[walletId];

  return c.json({ exists: true, address: wallet?.address, walletId });
});

app.post("/wallet/sign-typed-data", async (c) => {
  const body = await c.req.json<{
    userShare: string;
    walletId: string;
    typedData: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    };
  }>();

  if (!body.userShare || !body.walletId || !body.typedData) {
    return c.json({ error: "userShare, walletId, and typedData are required" }, 400);
  }

  const { allowed } = checkFreeTier(body.walletId);
  if (!allowed) {
    return c.json(
      { error: "FREE_TIER_EXHAUSTED", message: `Free tier limit (${FREE_TIER_LIMIT} operations) reached` },
      402
    );
  }

  const para = createPara();
  await para.setUserShare(body.userShare);

  const hash = hashTypedData(body.typedData as Parameters<typeof hashTypedData>[0]);
  const messageBase64 = hexStringToBase64(hash);

  const res = await para.signMessage({
    walletId: body.walletId,
    messageBase64,
  });

  if (!("signature" in res)) {
    return c.json({ error: "Signing was denied", details: res }, 403);
  }

  const signature = normalizeSignature(res.signature);
  recordUsage(body.walletId);

  return c.json({ signature });
});

// ── Sponsorship ─────────────────────────────────────────────────────────────

app.post("/sponsor", async (c) => {
  if (!SPONSOR_PRIVATE_KEY) {
    return c.json({ error: "NOT_CONFIGURED", message: "Sponsorship not available" }, 503);
  }

  const { address } = await c.req.json<{ address: string }>();
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: "Valid EVM address is required" }, 400);
  }

  const sponsorKey = address.toLowerCase();
  if (sponsorStore.has(sponsorKey)) {
    return c.json({ error: "ALREADY_SPONSORED", message: "This address already received sponsorship" }, 409);
  }

  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(SPONSOR_PRIVATE_KEY as Hex);

  const walletClient = createWalletClient({ account, chain: base, transport: http(BASE_RPC) });

  const ethTxHash = await walletClient.sendTransaction({
    to: address as `0x${string}`,
    value: parseEther(SPONSOR_ETH_AMOUNT),
  });

  const usdcTxHash = await walletClient.writeContract({
    address: USDC_ADDRESS,
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [address as `0x${string}`, parseUnits("0.1", 6)],
  });

  sponsorStore.set(sponsorKey, {
    ethTxHash,
    usdcTxHash,
    sponsoredAt: new Date().toISOString(),
  });

  return c.json({ ok: true, ethTxHash, usdcTxHash, ethAmount: SPONSOR_ETH_AMOUNT, usdcAmount: "0.10" });
});

// ── Auth/Recovery Routes ────────────────────────────────────────────────────

app.post("/auth/start", async (c) => {
  const { email } = await c.req.json<{ email: string }>();
  if (!email) return c.json({ error: "email is required" }, 400);

  const para = createPara();
  const authState = await para.signUpOrLogIn({ auth: { email } });

  const sessionId = crypto.randomUUID();

  const serialized = await para.exportSession();
  authSessions.set(`auth:${sessionId}`, {
    data: serialized,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 min TTL
  });

  const urls: Record<string, string> = {};
  const stage = authState.stage;

  if (stage === "login") {
    if (authState.passkeyUrl) urls.passkeyUrl = authState.passkeyUrl;
    if (authState.passwordUrl) urls.passwordUrl = authState.passwordUrl;
    if (authState.pinUrl) urls.pinUrl = authState.pinUrl;
  }

  return c.json({ sessionId, stage, urls });
});

app.post("/auth/verify", async (c) => {
  const { sessionId, code } = await c.req.json<{ sessionId: string; code: string }>();
  if (!sessionId || !code) return c.json({ error: "sessionId and code are required" }, 400);

  const session = authSessions.get(`auth:${sessionId}`);
  if (!session || session.expiresAt < Date.now()) {
    authSessions.delete(`auth:${sessionId}`);
    return c.json({ error: "Session expired or not found" }, 404);
  }

  const para = createPara();
  await para.importSession(session.data);
  await para.verifyNewAccount({ verificationCode: code });

  const updated = await para.exportSession();
  authSessions.set(`auth:${sessionId}`, {
    data: updated,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  return c.json({ sessionId, stage: "setup_auth", urls: {} });
});

app.get("/auth/status/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  if (!sessionId) return c.json({ error: "sessionId is required" }, 400);

  const session = authSessions.get(`auth:${sessionId}`);
  if (!session || session.expiresAt < Date.now()) {
    authSessions.delete(`auth:${sessionId}`);
    return c.json({ error: "Session expired or not found" }, 404);
  }

  const para = createPara();
  await para.importSession(session.data);

  const userShare = para.getUserShare();

  if (userShare) {
    const walletId = para.findWalletId(undefined, { type: ["EVM"] });
    const wallet = para.wallets[walletId];

    authSessions.delete(`auth:${sessionId}`);

    return c.json({
      complete: true,
      userShare,
      walletId,
      address: wallet?.address,
    });
  }

  const updated = await para.exportSession();
  authSessions.set(`auth:${sessionId}`, {
    data: updated,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  return c.json({ complete: false });
});

// ── Error Handler ───────────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error(`[${c.req.path}] Error:`, err);
  return c.json({ error: err.message || "Internal server error" }, 500);
});

// ── Start Server ────────────────────────────────────────────────────────────

console.log(`Starting para-x402-proxy on port ${PORT}`);
serve({ fetch: app.fetch, port: PORT });
