# Para + x402 + EnrichX402 Example

This example demonstrates how to use [Para](https://getpara.com) wallet infrastructure with the [x402](https://x402.org) payment protocol to make paid API calls to [EnrichX402](https://enrichx402.com).

## What This Does

1. Creates (or loads) a **Para pre-generated wallet** using the server SDK
2. Wraps the Para wallet as an **x402-compatible signer** via Para's viem integration
3. Makes a **paid API request** to EnrichX402's Exa web search endpoint
4. Payment is automatically signed by the Para wallet and settled in **USDC on Base mainnet**

## How It Works

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌────────────┐
│  Your App   │────▶│  Para Wallet │────▶│  x402 Client │────▶│ EnrichX402 │
│  (CLI)      │     │  (Signer)    │     │  (Payment)   │     │  (Server)  │
└─────────────┘     └──────────────┘     └──────────────┘     └────────────┘
                         │                      │                     │
                    Creates viem          Signs EIP-712          Responds with
                    account from          payment auth           402 → verifies
                    Para MPC wallet       for USDC transfer      → returns data
```

The key integration point: x402's `ClientEvmSigner` requires `{ address, signTypedData }` — which is exactly what Para's viem integration provides. Para handles the MPC signing, x402 handles the payment protocol, and EnrichX402 provides the data.

## Prerequisites

- Node.js 18+
- A [Para API key](https://developer.getpara.com)
- USDC on Base mainnet in your Para wallet (for paying EnrichX402)

## Setup

```bash
# Install dependencies
npm install

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your Para API key and a 32-character encryption key
```

## Usage

```bash
# Run with default search query
npm start

# Run with a custom search query
npm start "blockchain payment protocols 2025"
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PARA_API_KEY` | Your Para API key from [developer.getpara.com](https://developer.getpara.com) |
| `PARA_ENVIRONMENT` | `BETA` for testing, `PRODUCTION` for mainnet |
| `PARA_PREGEN_EMAIL` | Email identifier for the pre-generated wallet |
| `ENCRYPTION_KEY` | 32-character key for encrypting the stored key share |

## Architecture

- **`src/index.ts`** — Main script: initializes Para, creates x402 client, makes paid requests
- **`src/utils/encryption.ts`** — AES-GCM encryption for Para key shares
- **`src/utils/keystore.ts`** — Simple JSON file store for encrypted key shares

## Key Integration Pattern

The bridge between Para and x402 is straightforward:

```typescript
import { createParaAccount, createParaViemClient } from "@getpara/viem-v2-integration";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

// Para provides the wallet and signing
const paraAccount = createParaAccount(para);
const paraViemClient = createParaViemClient(para, { account: paraAccount, chain: base, transport: http() });

// Adapt Para's viem client to x402's signer interface
const paraSigner = {
  address: paraAccount.address,
  signTypedData: (args) => paraViemClient.signTypedData(args),
};

// Register with x402 and make paid requests
const client = new x402Client();
registerExactEvmScheme(client, { signer: paraSigner });
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// Any request to an x402-enabled server now auto-pays via Para
const response = await fetchWithPayment("https://enrichx402.com/api/exa/search", { ... });
```

## Links

- [Para Documentation](https://docs.getpara.com)
- [x402 Protocol](https://x402.org)
- [EnrichX402 API Docs](https://enrichx402.com/llms.txt)
- [x402 GitHub](https://github.com/coinbase/x402)
