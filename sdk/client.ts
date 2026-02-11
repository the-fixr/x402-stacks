/**
 * x402 Stacks SDK — Client Module
 *
 * Provides helpers for clients to:
 * 1. Parse 402 responses from resource servers
 * 2. Build and submit payment transactions
 * 3. Wrap fetch() with automatic x402 payment handling
 */

import {
  type X402ClientConfig,
  type PaymentRequired,
  type PaymentPayload,
  type PaymentRequirements,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_SIGNATURE,
} from "./types.js";

// ============================================================================
// 402 RESPONSE PARSING
// ============================================================================

/**
 * Check if a response is a 402 Payment Required
 */
export function is402Response(response: Response): boolean {
  return response.status === 402;
}

/**
 * Extract payment requirements from a 402 response
 */
export function parsePaymentRequired(
  response: Response
): PaymentRequired | null {
  const raw = response.headers.get(HEADER_PAYMENT_REQUIRED);
  if (!raw) return null;

  try {
    const decoded = atob(raw);
    return JSON.parse(decoded) as PaymentRequired;
  } catch {
    return null;
  }
}

// ============================================================================
// NONCE GENERATION
// ============================================================================

/**
 * Generate a random 16-byte nonce for payment replay protection
 */
export function generateNonce(): Uint8Array {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint8Array(16));
  }
  // Fallback for environments without crypto
  const nonce = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    nonce[i] = Math.floor(Math.random() * 256);
  }
  return nonce;
}

/**
 * Convert nonce bytes to hex string
 */
export function nonceToHex(nonce: Uint8Array): string {
  return Array.from(nonce)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ============================================================================
// TRANSACTION BUILDING
// ============================================================================

/**
 * Build the contract call arguments for pay-stx.
 *
 * This returns the parameters needed to call the x402-payments contract.
 * The actual transaction submission depends on your wallet library
 * (Leather, @stacks/transactions, etc.)
 *
 * Usage with @stacks/transactions:
 * ```ts
 * import { makeContractCall, broadcastTransaction } from "@stacks/transactions";
 * import { buildPayStxArgs, generateNonce } from "@x402/stacks/client";
 *
 * const nonce = generateNonce();
 * const args = buildPayStxArgs(requirements, nonce);
 *
 * const tx = await makeContractCall({
 *   contractAddress: args.contractAddress,
 *   contractName: args.contractName,
 *   functionName: args.functionName,
 *   functionArgs: args.functionArgs,
 *   postConditions: args.postConditions,
 *   senderKey: yourPrivateKey,
 *   network: "testnet",
 * });
 *
 * const result = await broadcastTransaction(tx);
 * ```
 */
export function buildPayStxArgs(
  requirements: PaymentRequirements,
  nonce: Uint8Array
): {
  contractAddress: string;
  contractName: string;
  functionName: string;
  functionArgs: {
    recipient: string;
    amount: string;
    nonce: string;
  };
} {
  return {
    contractAddress: requirements.extra.contractAddress,
    contractName: requirements.extra.contractName,
    functionName: "pay-stx",
    functionArgs: {
      recipient: requirements.payTo,
      amount: requirements.amount,
      nonce: `0x${nonceToHex(nonce)}`,
    },
  };
}

// ============================================================================
// PAYMENT PAYLOAD BUILDER
// ============================================================================

/**
 * Build the payment payload to send back to the server after paying
 */
export function buildPaymentPayload(
  paymentRequired: PaymentRequired,
  accepted: PaymentRequirements,
  txId: string,
  nonce: Uint8Array
): PaymentPayload {
  return {
    x402Version: 2,
    resource: paymentRequired.resource,
    accepted,
    payload: {
      txId,
      nonce: nonceToHex(nonce),
    },
  };
}

/**
 * Encode a payment payload for the PAYMENT-SIGNATURE header
 */
export function encodePaymentPayload(payload: PaymentPayload): string {
  return btoa(JSON.stringify(payload));
}

// ============================================================================
// FETCH WRAPPER
// ============================================================================

/**
 * Configuration for the auto-paying fetch wrapper
 */
export interface AutoPayConfig {
  /**
   * Called when a 402 is received. Must execute the payment and return
   * the transaction ID. If payment fails, throw an error.
   *
   * The function receives:
   * - requirements: the payment requirements from the 402 response
   * - nonce: a pre-generated 16-byte nonce to use in the contract call
   *
   * Example with Leather wallet:
   * ```ts
   * async pay(requirements, nonce) {
   *   const tx = await openContractCall({
   *     contractAddress: requirements.extra.contractAddress,
   *     contractName: requirements.extra.contractName,
   *     functionName: "pay-stx",
   *     functionArgs: [
   *       standardPrincipalCV(requirements.payTo),
   *       uintCV(requirements.amount),
   *       bufferCV(nonce),
   *     ],
   *   });
   *   return tx.txId;
   * }
   * ```
   */
  pay: (
    requirements: PaymentRequirements,
    nonce: Uint8Array
  ) => Promise<string>;

  /** Maximum time to wait for tx confirmation (ms, default 120000) */
  confirmationTimeout?: number;

  /** Poll interval for tx confirmation (ms, default 3000) */
  pollInterval?: number;

  /** Stacks API URL for checking tx status */
  apiUrl?: string;
}

/**
 * Wait for a transaction to be confirmed on-chain
 */
async function waitForConfirmation(
  txId: string,
  apiUrl: string,
  timeout: number,
  pollInterval: number
): Promise<boolean> {
  const start = Date.now();
  const cleanTxId = txId.startsWith("0x") ? txId : `0x${txId}`;

  while (Date.now() - start < timeout) {
    try {
      const resp = await fetch(`${apiUrl}/extended/v1/tx/${cleanTxId}`);
      if (resp.ok) {
        const data = (await resp.json()) as { tx_status: string };
        if (data.tx_status === "success") return true;
        if (
          data.tx_status === "abort_by_response" ||
          data.tx_status === "abort_by_post_condition"
        ) {
          return false;
        }
      }
    } catch {
      // Retry on network error
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }
  return false;
}

/**
 * Wrap fetch() with automatic x402 payment handling.
 *
 * If the request returns 402, this wrapper will:
 * 1. Parse the payment requirements
 * 2. Call your `pay` function to execute the payment
 * 3. Wait for transaction confirmation
 * 4. Retry the request with the PAYMENT-SIGNATURE header
 *
 * Usage:
 * ```ts
 * const payingFetch = wrapFetchWithPayment({
 *   pay: async (requirements, nonce) => {
 *     // Use Leather or @stacks/transactions to submit payment
 *     return txId;
 *   },
 * });
 *
 * // This will auto-pay if the server returns 402
 * const response = await payingFetch("https://api.example.com/premium");
 * ```
 */
export function wrapFetchWithPayment(
  config: AutoPayConfig
): typeof globalThis.fetch {
  const apiUrl = config.apiUrl || "https://api.testnet.hiro.so";
  const timeout = config.confirmationTimeout || 120_000;
  const pollInterval = config.pollInterval || 3_000;

  return async function payingFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    // Make the initial request
    const response = await fetch(input, init);

    // If not 402, return as-is
    if (!is402Response(response)) {
      return response;
    }

    // Parse payment requirements
    const paymentRequired = parsePaymentRequired(response);
    if (!paymentRequired || paymentRequired.accepts.length === 0) {
      return response; // Can't parse requirements, return original 402
    }

    // Pick the first accepted payment method
    const accepted = paymentRequired.accepts[0];

    // Generate nonce
    const nonce = generateNonce();

    // Execute payment
    const txId = await config.pay(accepted, nonce);

    // Wait for confirmation
    const confirmed = await waitForConfirmation(
      txId,
      apiUrl,
      timeout,
      pollInterval
    );

    if (!confirmed) {
      throw new Error(`Payment transaction ${txId} failed or timed out`);
    }

    // Build payment payload
    const payload = buildPaymentPayload(
      paymentRequired,
      accepted,
      txId,
      nonce
    );
    const encoded = encodePaymentPayload(payload);

    // Retry the request with payment proof
    const retryInit: RequestInit = {
      ...init,
      headers: {
        ...Object.fromEntries(
          new Headers(init?.headers).entries()
        ),
        [HEADER_PAYMENT_SIGNATURE]: encoded,
      },
    };

    return fetch(input, retryInit);
  };
}
