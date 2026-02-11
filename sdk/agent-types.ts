/**
 * AI Agent Protocol — TypeScript Types
 *
 * Types for the agent-registry, agent-vault, task-board, and reputation
 * Clarity contracts on Stacks.
 */

import type { StacksNetwork } from "./types.js";

// ============================================================================
// AGENT REGISTRY TYPES
// ============================================================================

export const STATUS_ACTIVE = 1;
export const STATUS_PAUSED = 2;
export const STATUS_DEREGISTERED = 3;

export type AgentStatus =
  | typeof STATUS_ACTIVE
  | typeof STATUS_PAUSED
  | typeof STATUS_DEREGISTERED;

export interface AgentRecord {
  name: string;
  descriptionUrl: string;
  status: AgentStatus;
  registeredAt: bigint;
  totalTasks: bigint;
  totalEarned: bigint;
  pricePerTask: bigint;
  acceptsStx: boolean;
  acceptsSip010: boolean;
}

export interface AgentCapability {
  capability: string;
}

export interface RegistryStats {
  totalAgents: bigint;
  admin: string;
}

// ============================================================================
// AGENT VAULT TYPES
// ============================================================================

export interface VaultRecord {
  balance: bigint;
  perTxCap: bigint;
  dailyCap: bigint;
  dailySpent: bigint;
  lastResetBlock: bigint;
  whitelistOnly: boolean;
  createdAt: bigint;
}

export interface SpendLogEntry {
  spender: string;
  amount: bigint;
  block: bigint;
  memo: string;
}

// ============================================================================
// TASK BOARD TYPES
// ============================================================================

export const TASK_OPEN = 1;
export const TASK_ASSIGNED = 2;
export const TASK_SUBMITTED = 3;
export const TASK_COMPLETED = 4;
export const TASK_DISPUTED = 5;
export const TASK_CANCELLED = 6;
export const TASK_EXPIRED = 7;

export type TaskStatus =
  | typeof TASK_OPEN
  | typeof TASK_ASSIGNED
  | typeof TASK_SUBMITTED
  | typeof TASK_COMPLETED
  | typeof TASK_DISPUTED
  | typeof TASK_CANCELLED
  | typeof TASK_EXPIRED;

export interface TaskRecord {
  poster: string;
  title: string;
  descriptionUrl: string;
  bounty: bigint;
  fee: bigint;
  assignedTo: string | null;
  status: TaskStatus;
  createdAt: bigint;
  deadline: bigint;
  submittedAt: bigint;
  completedAt: bigint;
  resultUrl: string;
}

export interface BidRecord {
  price: bigint;
  messageUrl: string;
  bidAt: bigint;
}

export interface TaskStats {
  totalTasks: bigint;
  feeBps: bigint;
  admin: string;
}

export interface TaskAttestation {
  agent: string;
  poster: string;
}

// ============================================================================
// REPUTATION TYPES
// ============================================================================

export interface ReputationRecord {
  totalScore: bigint;
  ratingCount: bigint;
  tasksCompleted: bigint;
  tasksDisputed: bigint;
  endorsementCount: bigint;
}

export interface RatingRecord {
  agent: string;
  score: bigint;
  block: bigint;
}

export interface EndorsementRecord {
  capability: string;
  block: bigint;
}

// ============================================================================
// SDK CONFIG
// ============================================================================

export interface AgentSDKConfig {
  /** Deployer principal (contract address prefix) */
  contractAddress: string;
  /** Stacks API URL (default: https://api.testnet.hiro.so) */
  apiUrl?: string;
  /** Network */
  network: StacksNetwork;
}

// ============================================================================
// ERROR CODES
// ============================================================================

/** agent-registry error codes */
export const REGISTRY_ERRORS = {
  ALREADY_REGISTERED: 1000,
  NOT_REGISTERED: 1001,
  UNAUTHORIZED: 1002,
  NAME_TOO_LONG: 1003,
  TOO_MANY_CAPS: 1004,
  INVALID_STATUS: 1005,
  NOT_DELEGATE: 1006,
} as const;

/** agent-vault error codes */
export const VAULT_ERRORS = {
  NO_VAULT: 1100,
  VAULT_EXISTS: 1101,
  UNAUTHORIZED: 1102,
  EXCEEDED_TX_CAP: 1103,
  EXCEEDED_DAILY_CAP: 1104,
  INSUFFICIENT_FUNDS: 1105,
  NOT_WHITELISTED: 1106,
  ZERO_AMOUNT: 1107,
  AGENT_NOT_REGISTERED: 1108,
  CONTRACT_CALL: 1109,
} as const;

/** task-board error codes */
export const TASK_ERRORS = {
  TASK_NOT_FOUND: 1200,
  UNAUTHORIZED: 1201,
  INVALID_STATUS: 1202,
  ALREADY_BID: 1203,
  NOT_ASSIGNED: 1204,
  ZERO_BOUNTY: 1205,
  SELF_ASSIGN: 1206,
  NOT_REGISTERED: 1207,
  DISPUTE_WINDOW: 1208,
  ALREADY_DISPUTED: 1209,
  NOT_ADMIN: 1210,
  TASK_EXPIRED: 1211,
  INVALID_FEE: 1212,
  SPLIT_MISMATCH: 1213,
  NO_BID: 1214,
  TITLE_TOO_LONG: 1215,
  CONTRACT_CALL: 1216,
} as const;

/** reputation error codes */
export const REPUTATION_ERRORS = {
  NOT_AUTHORIZED: 1300,
  ALREADY_RATED: 1301,
  INVALID_SCORE: 1302,
  SELF_ENDORSEMENT: 1303,
  NOT_REGISTERED: 1304,
  NO_ATTESTATION: 1305,
  TASK_MISMATCH: 1306,
} as const;
