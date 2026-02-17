# Para + x402 Example

Make paid API calls with a crypto wallet — no API key setup, no browser extensions.

## Quick Start

```bash
git clone https://github.com/adeets-22/para-x402-example-1
cd para-x402-example-1
npm install
npm start
```

That's it. The interactive CLI will:
1. **Create a wallet** for you (just enter your email)
2. **Fund it** with gas money so you can sign transactions
3. **Let you search** the web via x402 paid requests ($0.01 USDC each)

No Para API key needed. No browser extensions. No bridging tokens yourself.

## What This Does

Uses [Para](https://getpara.com) MPC wallets + the [x402](https://x402.org) payment protocol to make paid requests to [EnrichX402](https://enrichx402.com):

```
┌──────────┐     ┌────────────┐     ┌──────────────┐     ┌────────────┐
│  CLI     │────▶│  Proxy     │────▶│  x402 Client │────▶│ EnrichX402 │
│  (menu)  │     │  (signing) │     │  (payment)   │     │  (data)    │
└──────────┘     └────────────┘     └──────────────┘     └────────────┘
      │                │                    │                    │
  Your input     Para MPC wallet     Signs USDC payment    Returns search
  + local key    signs on server     authorization          results
  share store
```

**Key insight:** Your wallet's key share is stored encrypted on your machine. Signing happens via a hosted proxy that runs the Para SDK — so you never need a Para API key.

## How It Works

1. **Wallet creation** — You provide an email. The proxy creates a [Para pre-generated wallet](https://docs.getpara.com) using MPC (multi-party computation). Your key share is encrypted and stored locally.

2. **Gas sponsorship** — New wallets automatically receive a small amount of ETH on Base for transaction gas fees.

3. **Paid search** — When you search, the [x402 protocol](https://x402.org) handles payment. The server returns HTTP 402, the x402 client constructs a USDC payment authorization (EIP-3009), your key share signs it via the proxy, and the request is retried with payment proof.

4. **No custody risk** — The proxy never has full control of your wallet. It holds the server share; you hold the user share. Both are needed to sign. You can claim full custody at [getpara.com](https://getpara.com) anytime.

## Menu Options

| Option | Description |
|--------|-------------|
| **1) Create wallet** | Enter your email → wallet created + funded with gas |
| **2) Import wallet** | Load a previously created wallet from local keystore |
| **3) Recover wallet** | Reclaim your wallet on a new machine via browser auth |
| **4) Search** | Make a paid web search via x402 ($0.01 USDC per search) |
| **5) Check balance** | View ETH + USDC balance on Base |
| **6) Fund wallet** | Request gas sponsorship or get funding instructions |
| **7) Exit** | Quit |

## Wallet Recovery

If you move to a new machine and don't have your local keystore:

1. Select **option 3** and enter your email
2. A browser window opens for Para Portal authentication (passkey or password)
3. After authenticating, your key share is recovered and stored locally
4. Same wallet address, same funds — you're back in business

## Architecture

```
para-x402-example-1/
  proxy/                # Node.js server (Hono) — runs Para SDK server-side
    src/index.ts        #   Routes: wallet create/check/sign, sponsorship, auth
    Dockerfile          #   Container deployment (Railway, Fly.io, etc.)
  src/                  # Interactive CLI — no Para SDK dependency
    index.ts            #   Menu-driven interface
    utils/
      proxy-client.ts   #   HTTP client for the proxy
      signer.ts         #   x402-compatible signer (proxies signTypedData)
      encryption.ts     #   AES-GCM encryption for local key shares
      keystore.ts       #   Local JSON store for wallet data
```

The CLI never touches the Para SDK directly. It creates a `ClientEvmSigner` that proxies `signTypedData` calls to the hosted proxy over HTTPS. The proxy handles MPC key operations.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PARA_PREGEN_EMAIL` | No | Pre-fill email for auto-loading wallet on startup |
| `PROXY_URL` | No | Override proxy URL (defaults to hosted instance) |
| `ENCRYPTION_KEY` | No | Auto-generated on first wallet creation |

## Self-Hosting the Proxy

To run your own proxy instead of the hosted one:

```bash
cd proxy
npm install
PARA_API_KEY=your_key npm start
```

Or deploy to Railway / Fly.io / any Node.js host. Set `PARA_API_KEY` as an environment variable. Optionally set `SPONSOR_PRIVATE_KEY` (EOA private key on Base) to enable gas sponsorship for new users.

Then set `PROXY_URL` in your `.env` to your deployed URL.

## Links

- [Para Documentation](https://docs.getpara.com)
- [x402 Protocol](https://x402.org)
- [EnrichX402](https://enrichx402.com)
