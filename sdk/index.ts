/**
 * x402 Stacks SDK
 *
 * First x402 protocol implementation for Stacks blockchain.
 * Enables HTTP 402 micropayments using STX or SIP-010 tokens.
 *
 * @example Server (resource provider)
 * ```ts
 * import { withX402 } from "@x402/stacks/server";
 *
 * const config = {
 *   contractAddress: "ST...",
 *   network: "stacks:2147483648", // testnet
 *   payTo: "ST...",
 * };
 *
 * const result = await withX402(config, request, {
 *   amount: "10000", // 0.01 STX
 * });
 *
 * if (!result.allowed) return new Response(result.response.body, result.response);
 * // Proceed — payment verified
 * ```
 *
 * @example Client (payer)
 * ```ts
 * import { wrapFetchWithPayment } from "@x402/stacks/client";
 *
 * const payingFetch = wrapFetchWithPayment({
 *   pay: async (requirements, nonce) => {
 *     // Submit payment via Leather wallet or @stacks/transactions
 *     return txId;
 *   },
 * });
 *
 * const response = await payingFetch("https://api.example.com/premium");
 * ```
 */

// Re-export everything
export * from "./types.js";
export * from "./server.js";
export * from "./client.js";

