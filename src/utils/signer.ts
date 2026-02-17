import { signTypedData } from "./proxy-client.js";

/**
 * Creates a ClientEvmSigner that proxies signTypedData calls to the remote proxy.
 * This satisfies x402's signer interface: { address, signTypedData }.
 */
export function createProxySigner(
  address: `0x${string}`,
  userShare: string,
  walletId: string
) {
  return {
    address,
    signTypedData: (msg: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<`0x${string}`> => {
      return signTypedData(userShare, walletId, msg);
    },
  } as const;
}
