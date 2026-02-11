/**
 * x402 Stacks SDK — Server Module
 *
 * Provides middleware and helpers for resource servers to:
 * 1. Return 402 Payment Required responses with payment details
 * 2. Verify payments by reading on-chain nonce records
 * 3. Wrap route handlers with automatic x402 payment gating
 */

import {
  type X402ServerConfig,
  type PaymentRequired,
  type PaymentPayload,
  type PaymentRequirements,
  type PaymentReceipt,
  type ResourceInfo,
  type VerifyResponse,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_SIGNATURE,
  HEADER_PAYMENT_RESPONSE,
} from "./types.js";

// ============================================================================
// PAYMENT REQUIREMENTS BUILDER
// ============================================================================

/**
 * Build payment requirements for a 402 response
 */
export function buildPaymentRequirements(
  config: X402ServerConfig,
  options: {
    /** Amount in microSTX (or token atomic units) */
    amount: string | number | bigint;
    /** "STX" or SIP-010 contract principal */
    asset?: string;
    /** Max time for payment completion (default 300s) */
    maxTimeoutSeconds?: number;
  }
): PaymentRequirements {
  return {
    scheme: "exact",
    network: config.network,
    asset: options.asset || "STX",
    amount: String(options.amount),
    payTo: config.payTo,
    maxTimeoutSeconds: options.maxTimeoutSeconds || 300,
    extra: {
      contractAddress: config.contractAddress,
      contractName: config.contractName || "x402-payments",
    },
  };
}

/**
 * Build a full 402 Payment Required response body
 */
export function buildPaymentRequired(
  config: X402ServerConfig,
  resource: ResourceInfo,
  options: {
    amount: string | number | bigint;
    asset?: string;
    maxTimeoutSeconds?: number;
    error?: string;
  }
): PaymentRequired {
  return {
    x402Version: 2,
    error: options.error || "Payment required",
    resource,
    accepts: [buildPaymentRequirements(config, options)],
  };
}

// ============================================================================
// PAYMENT VERIFICATION
// ============================================================================

/**
 * Verify a payment by reading the on-chain nonce record
 *
 * Calls the x402-payments contract's `verify-payment` read-only function
 * via the Stacks API.
 */
export async function verifyPayment(
  config: X402ServerConfig,
  payload: PaymentPayload
): Promise<VerifyResponse> {
  const apiUrl =
    config.apiUrl ||
    (config.network === "stacks:1"
      ? "https://api.hiro.so"
      : "https://api.testnet.hiro.so");

  const contractAddress = config.contractAddress;
  const contractName = config.contractName || "x402-payments";

  // First verify the transaction was confirmed
  const txUrl = `${apiUrl}/extended/v1/tx/${payload.payload.txId}`;
  try {
    const txResp = await fetch(txUrl);
    if (!txResp.ok) {
      return { isValid: false, invalidReason: "Transaction not found" };
    }

    const txData = (await txResp.json()) as {
      tx_status: string;
      sender_address?: string;
      contract_call?: {
        contract_id: string;
        function_name: string;
        function_args?: Array<{ repr: string }>;
      };
    };

    // Must be confirmed
    if (txData.tx_status !== "success") {
      return {
        isValid: false,
        invalidReason: `Transaction status: ${txData.tx_status}`,
      };
    }

    // Must call our x402-payments contract
    const expectedContract = `${contractAddress}.${contractName}`;
    if (txData.contract_call?.contract_id !== expectedContract) {
      return {
        isValid: false,
        invalidReason: `Wrong contract: ${txData.contract_call?.contract_id}`,
      };
    }

    // Must call pay-stx or pay-sip010
    const fn = txData.contract_call?.function_name;
    if (fn !== "pay-stx" && fn !== "pay-sip010") {
      return {
        isValid: false,
        invalidReason: `Wrong function: ${fn}`,
      };
    }

    // Now verify the nonce on-chain via read-only call
    const nonceHex = payload.payload.nonce.replace(/^0x/, "");
    const verifyUrl = `${apiUrl}/v2/contracts/call-read/${contractAddress}/${contractName}/verify-payment`;

    const verifyResp = await fetch(verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: contractAddress,
        arguments: [`0x${nonceHex}`],
      }),
    });

    if (!verifyResp.ok) {
      return {
        isValid: false,
        invalidReason: "Failed to call verify-payment",
      };
    }

    const verifyData = (await verifyResp.json()) as {
      okay: boolean;
      result?: string;
    };

    if (!verifyData.okay || !verifyData.result) {
      return { isValid: false, invalidReason: "Contract call failed" };
    }

    // If result contains "none", payment wasn't recorded
    if (verifyData.result.includes("none")) {
      return { isValid: false, invalidReason: "Nonce not found on-chain" };
    }

    // Payment verified: extract payer from transaction
    return {
      isValid: true,
      payer: txData.sender_address,
      amount: payload.accepted.amount,
      recipient: payload.accepted.payTo,
    };
  } catch (error) {
    return {
      isValid: false,
      invalidReason: `Verification error: ${error}`,
    };
  }
}

// ============================================================================
// HTTP HELPERS
// ============================================================================

/**
 * Create a 402 Payment Required Response (for use with any framework)
 */
export function create402Response(
  config: X402ServerConfig,
  request: { url: string },
  options: {
    amount: string | number | bigint;
    asset?: string;
    description?: string;
    mimeType?: string;
  }
): {
  status: 402;
  headers: Record<string, string>;
  body: { error: string; message: string };
} {
  const resource: ResourceInfo = {
    url: request.url,
    description: options.description || "Protected resource",
    mimeType: options.mimeType || "application/json",
  };

  const paymentRequired = buildPaymentRequired(config, resource, {
    amount: options.amount,
    asset: options.asset,
  });

  const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString(
    "base64"
  );

  return {
    status: 402,
    headers: {
      [HEADER_PAYMENT_REQUIRED]: encoded,
      "Content-Type": "application/json",
    },
    body: {
      error: "payment_required",
      message: `Payment required to access ${request.url}`,
    },
  };
}

/**
 * Extract and decode payment payload from request headers
 */
export function extractPaymentPayload(
  headers: Record<string, string | undefined>
): PaymentPayload | null {
  const raw =
    headers[HEADER_PAYMENT_SIGNATURE] ||
    headers[HEADER_PAYMENT_SIGNATURE.toLowerCase()];

  if (!raw) return null;

  try {
    const decoded = Buffer.from(raw, "base64").toString("utf-8");
    return JSON.parse(decoded) as PaymentPayload;
  } catch {
    return null;
  }
}

// ============================================================================
// MIDDLEWARE PATTERN
// ============================================================================

/**
 * Wrap an async handler with x402 payment gating.
 *
 * Usage (framework-agnostic):
 * ```ts
 * const result = await withX402(config, request, {
 *   amount: "10000", // 0.01 STX
 *   description: "Premium API endpoint",
 * });
 *
 * if (!result.allowed) {
 *   // Return result.response (402 Payment Required)
 * }
 * // Proceed — result.payer is the verified wallet
 * ```
 */
export async function withX402(
  config: X402ServerConfig,
  request: {
    url: string;
    headers: Record<string, string | undefined>;
  },
  options: {
    amount: string | number | bigint;
    asset?: string;
    description?: string;
  }
): Promise<
  | { allowed: true; payer: string; payload: PaymentPayload }
  | {
      allowed: false;
      response: {
        status: number;
        headers: Record<string, string>;
        body: unknown;
      };
    }
> {
  // Check for payment header
  const payload = extractPaymentPayload(request.headers);

  if (!payload) {
    // No payment — return 402
    return {
      allowed: false,
      response: create402Response(config, request, options),
    };
  }

  // Verify the payment
  const verification = await verifyPayment(config, payload);

  if (!verification.isValid) {
    return {
      allowed: false,
      response: {
        status: 402,
        headers: { "Content-Type": "application/json" },
        body: {
          error: "payment_invalid",
          message: verification.invalidReason || "Payment verification failed",
        },
      },
    };
  }

  return {
    allowed: true,
    payer: verification.payer!,
    payload,
  };
}
