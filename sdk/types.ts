/**
 * x402 Stacks SDK — Core Types
 *
 * Follows the x402 protocol v2 spec (CAIP-2 network IDs, PaymentRequired/PaymentPayload)
 * adapted for Stacks blockchain (STX + SIP-010 tokens).
 */

// CAIP-2 network identifiers for Stacks
export const STACKS_MAINNET = "stacks:1" as const;
export const STACKS_TESTNET = "stacks:2147483648" as const;

export type StacksNetwork = typeof STACKS_MAINNET | typeof STACKS_TESTNET;

// ============================================================================
// x402 Protocol Types (v2 compatible)
// ============================================================================

/** Resource being gated behind payment */
export interface ResourceInfo {
  url: string;
  description: string;
  mimeType: string;
}

/** What the server accepts as payment */
export interface PaymentRequirements {
  scheme: "exact";
  network: StacksNetwork;
  asset: "STX" | string; // "STX" for native, or SIP-010 contract principal
  amount: string; // Atomic units as string (microSTX for STX)
  payTo: string; // Recipient Stacks address
  maxTimeoutSeconds: number;
  extra: {
    contractAddress: string; // x402-payments contract address
    contractName: string; // "x402-payments"
  };
}

/** Full 402 response from server */
export interface PaymentRequired {
  x402Version: 2;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
}

/** What the client sends back after paying */
export interface PaymentPayload {
  x402Version: 2;
  resource: ResourceInfo;
  accepted: PaymentRequirements;
  payload: {
    txId: string; // Stacks transaction ID
    nonce: string; // Hex-encoded 16-byte nonce used in payment
  };
}

/** Verification result from server */
export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
  amount?: string;
  recipient?: string;
}

/** Settlement result */
export interface SettleResponse {
  success: boolean;
  transaction: string;
  network: StacksNetwork;
  payer?: string;
}

// ============================================================================
// Payment Receipt (from on-chain contract)
// ============================================================================

export interface PaymentReceipt {
  payer: string;
  recipient: string;
  amount: bigint;
  fee: bigint;
  block: bigint;
  isStx: boolean;
}

// ============================================================================
// SDK Configuration
// ============================================================================

export interface X402ServerConfig {
  /** x402-payments contract address (deployer principal) */
  contractAddress: string;
  /** Contract name (default: "x402-payments") */
  contractName?: string;
  /** Stacks API URL */
  apiUrl?: string;
  /** Network */
  network: StacksNetwork;
  /** Recipient address for payments */
  payTo: string;
}

export interface X402ClientConfig {
  /** Stacks API URL */
  apiUrl?: string;
  /** Network */
  network: StacksNetwork;
}

// ============================================================================
// HTTP Headers (x402 protocol v2)
// ============================================================================

export const HEADER_PAYMENT_REQUIRED = "PAYMENT-REQUIRED";
export const HEADER_PAYMENT_SIGNATURE = "PAYMENT-SIGNATURE";
export const HEADER_PAYMENT_RESPONSE = "PAYMENT-RESPONSE";
