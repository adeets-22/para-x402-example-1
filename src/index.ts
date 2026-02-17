import "dotenv/config";
import * as readline from "readline/promises";
import { execFile } from "child_process";
import { stdin, stdout } from "process";
import { createPublicClient, http, formatUnits } from "viem";
import { base } from "viem/chains";
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { encrypt, decrypt, ensureEncryptionKey } from "./utils/encryption.js";
import { getStoredWallet, setWallet, listWallets } from "./utils/keystore.js";
import * as proxy from "./utils/proxy-client.js";
import { createProxySigner } from "./utils/signer.js";

// ── Constants ────────────────────────────────────────────────────────────────

const ENRICHX402_BASE_URL = "https://enrichx402.com";
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// ── State ────────────────────────────────────────────────────────────────────

let activeWallet: {
  address: `0x${string}`;
  walletId: string;
  userShare: string;
  email: string;
} | null = null;

let rl: readline.Interface;

// ── Helpers ──────────────────────────────────────────────────────────────────

function banner() {
  console.log(`
╔══════════════════════════════════════╗
║   Para + x402 Example               ║
╚══════════════════════════════════════╝`);
}

function walletStatus(): string {
  if (!activeWallet) return "  No wallet loaded\n";
  return `  Wallet: ${activeWallet.address}\n  Email:  ${activeWallet.email}\n`;
}

async function prompt(question: string): Promise<string> {
  const answer = await rl.question(question);
  return answer.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function openUrl(url: string): void {
  // Use execFile (not exec) to avoid shell injection
  try {
    execFile("open", [url], () => {});
  } catch { /* best-effort, non-critical */ }
}

// ── Menu Actions ─────────────────────────────────────────────────────────────

async function createWallet() {
  const email = await prompt("Email address: ");
  if (!email) return;

  ensureEncryptionKey();
  console.log("\nCreating wallet...");

  const result = await proxy.createWallet(email);

  // Encrypt and store locally
  const encryptedShare = await encrypt(result.userShare);
  await setWallet({
    encryptedShare,
    walletId: result.walletId,
    address: result.address,
    email,
    createdAt: new Date().toISOString(),
  });

  activeWallet = {
    address: result.address as `0x${string}`,
    walletId: result.walletId,
    userShare: result.userShare,
    email,
  };

  if (result.existing) {
    console.log(`\n✓ Loaded existing wallet for ${email}`);
  } else {
    console.log(`\n✓ New wallet created!`);
  }
  console.log(`  Address: ${result.address}`);

  // Auto-request sponsorship for new wallets
  if (!result.existing) {
    console.log("\nRequesting initial funds...");
    try {
      const sponsor = await proxy.requestSponsorship(result.address);
      console.log(`✓ Funded with ${sponsor.ethAmount} ETH + $${sponsor.usdcAmount} USDC on Base`);
      console.log(`  ETH tx:  ${sponsor.ethTxHash}`);
      console.log(`  USDC tx: ${sponsor.usdcTxHash}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ALREADY_SPONSORED")) {
        console.log("  (Already received sponsorship)");
      } else {
        console.log(`  Sponsorship unavailable: ${msg}`);
        console.log("  You can fund your wallet manually — see option 6.");
      }
    }
  }
}

async function importWallet() {
  const wallets = await listWallets();
  if (wallets.length === 0) {
    console.log("\nNo wallets in local keystore. Create one first.");
    return;
  }

  console.log("\nStored wallets:");
  wallets.forEach((w, i) => {
    console.log(`  ${i + 1}) ${w.email} — ${w.address.slice(0, 10)}...${w.address.slice(-6)}`);
  });

  const choice = await prompt(`\nSelect wallet (1-${wallets.length}): `);
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= wallets.length) {
    console.log("Invalid selection.");
    return;
  }

  const entry = wallets[idx];
  ensureEncryptionKey();
  const userShare = await decrypt(entry.encryptedShare);

  activeWallet = {
    address: entry.address as `0x${string}`,
    walletId: entry.walletId,
    userShare,
    email: entry.email,
  };

  console.log(`\n✓ Loaded wallet for ${entry.email}`);
  console.log(`  Address: ${entry.address}`);
}

async function recoverWallet() {
  const email = await prompt("Email address used to create wallet: ");
  if (!email) return;

  // Check wallet exists
  console.log("\nChecking wallet...");
  const check = await proxy.checkWallet(email);
  if (!check.exists) {
    console.log("No wallet found for this email. Use option 1 to create one.");
    return;
  }

  // Start auth flow
  console.log("Starting recovery...");
  const auth = await proxy.authStart(email);

  if (auth.stage === "verify") {
    // New account — needs OTP
    const code = await prompt("Enter the verification code sent to your email: ");
    const verified = await proxy.authVerify(auth.sessionId, code);

    if (Object.keys(verified.urls).length > 0) {
      const url = verified.urls.passkeyUrl || verified.urls.passwordUrl || Object.values(verified.urls)[0];
      console.log(`\nOpen this URL in your browser to complete auth:\n  ${url}`);
      openUrl(url);
    }
  } else if (auth.stage === "login" && Object.keys(auth.urls).length > 0) {
    const url = auth.urls.passkeyUrl || auth.urls.passwordUrl || Object.values(auth.urls)[0];
    console.log(`\nOpen this URL in your browser to authenticate:\n  ${url}`);
    openUrl(url);
  }

  // Poll for completion
  console.log("\nWaiting for browser authentication...");
  const maxAttempts = 60; // 2 minutes
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    process.stdout.write(".");

    const status = await proxy.authStatus(auth.sessionId);
    if (status.complete && status.userShare) {
      console.log("\n\n✓ Authentication complete! Wallet recovered.");

      ensureEncryptionKey();
      const encryptedShare = await encrypt(status.userShare);
      await setWallet({
        encryptedShare,
        walletId: status.walletId!,
        address: status.address!,
        email,
        createdAt: new Date().toISOString(),
      });

      activeWallet = {
        address: status.address as `0x${string}`,
        walletId: status.walletId!,
        userShare: status.userShare,
        email,
      };

      console.log(`  Address: ${status.address}`);
      console.log("  Key share saved to local keystore.");
      return;
    }
  }

  console.log("\n\nTimeout — authentication not completed within 2 minutes.");
  console.log("Try again with option 3.");
}

async function search() {
  if (!activeWallet) {
    console.log("\nNo wallet loaded. Create or import one first.");
    return;
  }

  const query = await prompt("Search query: ");
  if (!query) return;

  // Create x402 client with proxy signer
  const signer = createProxySigner(activeWallet.address, activeWallet.userShare, activeWallet.walletId);
  const x402 = new x402Client();
  registerExactEvmScheme(x402, { signer });
  const fetchWithPayment = wrapFetchWithPayment(fetch, x402);

  console.log(`\nSearching for: "${query}"`);
  console.log("Payment will be signed and settled in USDC on Base...\n");

  const response = await fetchWithPayment(`${ENRICHX402_BASE_URL}/api/exa/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      numResults: 5,
      type: "auto",
      contents: {
        text: { maxCharacters: 300 },
        highlights: { numSentences: 2 },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.log(`Request failed (${response.status}): ${errorText}`);
    return;
  }

  const data = (await response.json()) as {
    results?: Array<{ title: string; url: string; publishedDate?: string; text?: string }>;
  };

  console.log("=== Search Results ===\n");
  if (data.results && Array.isArray(data.results)) {
    for (const result of data.results) {
      console.log(`  Title: ${result.title}`);
      console.log(`  URL:   ${result.url}`);
      if (result.publishedDate) console.log(`  Date:  ${result.publishedDate}`);
      if (result.text) console.log(`  Text:  ${result.text.slice(0, 200)}...`);
      console.log("  ---");
    }
  } else {
    console.log(JSON.stringify(data, null, 2));
  }

  // Show payment info
  const httpClient = new x402HTTPClient(x402);
  try {
    const paymentResponse = httpClient.getPaymentSettleResponse((name) => response.headers.get(name));
    console.log("\n✓ Payment settled:", JSON.stringify(paymentResponse, null, 2));
  } catch {
    console.log("\n  (Payment settlement info not available in response headers)");
  }
}

async function checkBalance() {
  if (!activeWallet) {
    console.log("\nNo wallet loaded. Create or import one first.");
    return;
  }

  console.log("\nChecking balances on Base...");
  const client = createPublicClient({ chain: base, transport: http() });

  const [ethBalance, usdcBalance] = await Promise.all([
    client.getBalance({ address: activeWallet.address }),
    client.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [activeWallet.address],
    }),
  ]);

  console.log(`\n  ETH:  ${formatUnits(ethBalance, 18)} ETH`);
  console.log(`  USDC: ${formatUnits(usdcBalance, 6)} USDC`);
}

async function fundWallet() {
  if (!activeWallet) {
    console.log("\nNo wallet loaded. Create or import one first.");
    return;
  }

  console.log(`\nYour wallet address (Base network):`);
  console.log(`  ${activeWallet.address}`);

  const choice = await prompt("\nRequest sponsorship (free gas + $0.10 USDC)? (y/n): ");
  if (choice.toLowerCase() === "y") {
    try {
      const sponsor = await proxy.requestSponsorship(activeWallet.address);
      console.log(`\n✓ Funded with ${sponsor.ethAmount} ETH + $${sponsor.usdcAmount} USDC`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ALREADY_SPONSORED")) {
        console.log("\n  Already received sponsorship.");
      } else {
        console.log(`\n  Sponsorship unavailable: ${msg}`);
      }
    }
  }

  console.log("\nTo add more funds, send USDC to your address on Base.");
  console.log("Bridge from Ethereum: https://bridge.base.org");
}

// ── Main Loop ────────────────────────────────────────────────────────────────

async function main() {
  rl = readline.createInterface({ input: stdin, output: stdout });

  banner();

  // Auto-load wallet from env if email is set
  const envEmail = process.env.PARA_PREGEN_EMAIL;
  if (envEmail) {
    const stored = await getStoredWallet(envEmail);
    if (stored && stored.walletId) {
      try {
        ensureEncryptionKey();
        const userShare = await decrypt(stored.encryptedShare);
        activeWallet = {
          address: stored.address as `0x${string}`,
          walletId: stored.walletId,
          userShare,
          email: stored.email,
        };
        console.log(`  Auto-loaded wallet for ${envEmail}`);
      } catch {
        // Decryption failed — user can re-create or import
      }
    }
  }

  while (true) {
    console.log(`\n${walletStatus()}`);
    console.log("  1) Create new wallet (email-based)");
    console.log("  2) Import existing wallet (local keystore)");
    console.log("  3) Recover wallet (browser auth, new machine)");
    console.log("  4) Search the web (x402 paid request)");
    console.log("  5) Check wallet balance");
    console.log("  6) Fund wallet");
    console.log("  7) Exit\n");

    const choice = await prompt("> ");

    try {
      switch (choice) {
        case "1": await createWallet(); break;
        case "2": await importWallet(); break;
        case "3": await recoverWallet(); break;
        case "4": await search(); break;
        case "5": await checkBalance(); break;
        case "6": await fundWallet(); break;
        case "7":
          console.log("\nBye!");
          rl.close();
          process.exit(0);
        default:
          console.log("  Invalid choice. Enter 1-7.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\nError: ${msg}`);
    }
  }
}

main();
