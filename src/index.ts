import "dotenv/config";
import { Para as ParaServer, Environment } from "@getpara/server-sdk";
import { createParaAccount } from "@getpara/viem-v2-integration";
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { encrypt, decrypt } from "./utils/encryption.js";
import { getKeyShare, setKeyShare } from "./utils/keystore.js";

const ENRICHX402_BASE_URL = "https://enrichx402.com";

async function main() {
  // ── 1. Validate environment ──────────────────────────────────────────
  const PARA_API_KEY = process.env.PARA_API_KEY;
  const PARA_ENVIRONMENT = (process.env.PARA_ENVIRONMENT as Environment) || Environment.BETA;
  const PREGEN_EMAIL = process.env.PARA_PREGEN_EMAIL;

  if (!PARA_API_KEY) {
    throw new Error("PARA_API_KEY is required. Set it in your .env file.");
  }
  if (!PREGEN_EMAIL) {
    throw new Error("PARA_PREGEN_EMAIL is required. Set it in your .env file.");
  }

  console.log("Initializing Para server SDK...");
  const para = new ParaServer(PARA_ENVIRONMENT, PARA_API_KEY);

  // ── 2. Create or load a pre-generated wallet ─────────────────────────
  const walletExists = await para.hasPregenWallet({ pregenId: { email: PREGEN_EMAIL } });

  if (!walletExists) {
    console.log(`Creating new pre-generated wallet for ${PREGEN_EMAIL}...`);
    await para.createPregenWalletPerType({
      types: ["EVM"],
      pregenId: { email: PREGEN_EMAIL },
    });

    const userShare = para.getUserShare();
    if (!userShare) {
      throw new Error("Failed to retrieve user share after wallet creation");
    }

    const encryptedShare = await encrypt(userShare);
    await setKeyShare(PREGEN_EMAIL, encryptedShare);
    console.log("Wallet created and key share stored.");
  } else {
    console.log(`Loading existing wallet for ${PREGEN_EMAIL}...`);
    const encryptedShare = await getKeyShare(PREGEN_EMAIL);
    if (!encryptedShare) {
      throw new Error("Wallet exists but no key share found in local store. Re-create the wallet or restore the key share.");
    }
    const decryptedShare = await decrypt(encryptedShare);
    await para.setUserShare(decryptedShare);
  }

  // ── 3. Create Para viem account ──────────────────────────────────────
  //
  // createParaAccount() returns a standard viem LocalAccount that implements
  // signTypedData — which is exactly what x402's ClientEvmSigner needs.
  // No WalletClient or RPC connection required since we're only signing.
  const paraAccount = createParaAccount(para);

  console.log(`Para wallet address: ${paraAccount.address}`);

  // ── 4. Create x402 client with Para as the signer ───────────────────
  const x402 = new x402Client();
  registerExactEvmScheme(x402, { signer: paraAccount });

  const fetchWithPayment = wrapFetchWithPayment(fetch, x402);

  // ── 5. Make a paid request to EnrichX402's Exa search ────────────────
  const searchQuery = process.argv[2] || "latest developments in AI agents and crypto payments";

  console.log(`\nSearching EnrichX402 for: "${searchQuery}"`);
  console.log("Payment will be signed by Para wallet and settled in USDC on Base...\n");

  const response = await fetchWithPayment(`${ENRICHX402_BASE_URL}/api/exa/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: searchQuery,
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
    throw new Error(`EnrichX402 request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  // ── 6. Display results ───────────────────────────────────────────────
  console.log("=== Search Results ===\n");

  if (data.results && Array.isArray(data.results)) {
    for (const result of data.results) {
      console.log(`Title: ${result.title}`);
      console.log(`URL:   ${result.url}`);
      if (result.publishedDate) {
        console.log(`Date:  ${result.publishedDate}`);
      }
      if (result.text) {
        console.log(`Text:  ${result.text.slice(0, 200)}...`);
      }
      console.log("---");
    }
  } else {
    console.log("Response:", JSON.stringify(data, null, 2));
  }

  // ── 7. Show payment details ──────────────────────────────────────────
  const httpClient = new x402HTTPClient(x402);
  try {
    const paymentResponse = httpClient.getPaymentSettleResponse((name) =>
      response.headers.get(name)
    );
    console.log("\nPayment settled:", JSON.stringify(paymentResponse, null, 2));
  } catch {
    console.log("\nPayment settlement info not available in response headers.");
  }
}

main().catch((error) => {
  console.error("Error:", error.message || error);
  process.exit(1);
});
