/**
 * AI Agent Protocol — Reader Module (Read-Only Queries)
 *
 * Fetches on-chain state from agent-registry, agent-vault, task-board,
 * and reputation contracts via the Stacks API. All calls are free
 * (read-only contract calls cost no gas on Stacks).
 */

import type {
  AgentSDKConfig,
  AgentRecord,
  AgentCapability,
  RegistryStats,
  VaultRecord,
  SpendLogEntry,
  TaskRecord,
  BidRecord,
  TaskStats,
  TaskAttestation,
  ReputationRecord,
  RatingRecord,
  EndorsementRecord,
} from "./agent-types.js";

// ============================================================================
// HELPERS
// ============================================================================

const DEFAULT_API = "https://api.testnet.hiro.so";

function apiUrl(config: AgentSDKConfig): string {
  return config.apiUrl || DEFAULT_API;
}

function contractUrl(
  config: AgentSDKConfig,
  contractName: string,
  fnName: string
): string {
  const base = apiUrl(config);
  const addr = config.contractAddress;
  return `${base}/v2/contracts/call-read/${addr}/${contractName}/${fnName}`;
}

interface ClarityValue {
  type: string;
  value: unknown;
}

async function callReadOnly(
  config: AgentSDKConfig,
  contractName: string,
  fnName: string,
  args: string[] = []
): Promise<ClarityValue | null> {
  const url = contractUrl(config, contractName, fnName);
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: config.contractAddress,
      arguments: args,
    }),
  });

  if (!resp.ok) return null;

  const data = (await resp.json()) as { okay: boolean; result: string };
  if (!data.okay) return null;

  return decodeClarityHex(data.result);
}

/**
 * Decode a Clarity hex-encoded value into a JS-friendly structure.
 * This is a simplified decoder for the most common return types.
 */
function decodeClarityHex(hex: string): ClarityValue {
  // The Stacks API returns Clarity values as hex-encoded serialized data.
  // For a full decoder, use @stacks/transactions cvToJSON.
  // This returns the raw hex for consumers to decode with their preferred lib.
  return { type: "raw", value: hex };
}

// ============================================================================
// PRINCIPAL ENCODING
// ============================================================================

/**
 * Encode a Stacks principal as a Clarity hex argument for read-only calls.
 * Uses the cv_consts format expected by the Stacks API.
 */
function encodePrincipal(principal: string): string {
  // The Stacks API accepts hex-encoded Clarity values as arguments.
  // For simplicity, we use the string representation and let the API decode.
  // In production, use @stacks/transactions Cl.principal() + cvToHex().
  return `0x${Buffer.from(
    JSON.stringify({ type: "principal", value: principal })
  ).toString("hex")}`;
}

function encodeUint(value: bigint | number): string {
  return `0x${Buffer.from(
    JSON.stringify({ type: "uint", value: value.toString() })
  ).toString("hex")}`;
}

// ============================================================================
// AGENT REGISTRY READERS
// ============================================================================

export async function getAgent(
  config: AgentSDKConfig,
  owner: string
): Promise<ClarityValue | null> {
  return callReadOnly(config, "agent-registry", "get-agent", [
    encodePrincipal(owner),
  ]);
}

export async function getCapability(
  config: AgentSDKConfig,
  owner: string,
  index: number
): Promise<ClarityValue | null> {
  return callReadOnly(config, "agent-registry", "get-capability", [
    encodePrincipal(owner),
    encodeUint(index),
  ]);
}

export async function isRegistered(
  config: AgentSDKConfig,
  owner: string
): Promise<ClarityValue | null> {
  return callReadOnly(config, "agent-registry", "is-registered", [
    encodePrincipal(owner),
  ]);
}

export async function isActive(
  config: AgentSDKConfig,
  owner: string
): Promise<ClarityValue | null> {
  return callReadOnly(config, "agent-registry", "is-active", [
    encodePrincipal(owner),
  ]);
}

export async function isDelegate(
  config: AgentSDKConfig,
  owner: string,
  delegate: string
): Promise<ClarityValue | null> {
  return callReadOnly(config, "agent-registry", "is-delegate", [
    encodePrincipal(owner),
    encodePrincipal(delegate),
  ]);
}

export async function getRegistryStats(
  config: AgentSDKConfig
): Promise<ClarityValue | null> {
  return callReadOnly(config, "agent-registry", "get-stats");
}

// ============================================================================
// AGENT VAULT READERS
// ============================================================================

export async function getVault(
  config: AgentSDKConfig,
  owner: string
): Promise<ClarityValue | null> {
  return callReadOnly(config, "agent-vault", "get-vault", [
    encodePrincipal(owner),
  ]);
}

export async function isWhitelisted(
  config: AgentSDKConfig,
  owner: string,
  target: string
): Promise<ClarityValue | null> {
  return callReadOnly(config, "agent-vault", "is-whitelisted", [
    encodePrincipal(owner),
    encodePrincipal(target),
  ]);
}

export async function getAvailableDaily(
  config: AgentSDKConfig,
  owner: string
): Promise<ClarityValue | null> {
  return callReadOnly(config, "agent-vault", "get-available-daily", [
    encodePrincipal(owner),
  ]);
}

export async function getSpendLogEntry(
  config: AgentSDKConfig,
  owner: string,
  seq: bigint
): Promise<ClarityValue | null> {
  return callReadOnly(config, "agent-vault", "get-spend-log-entry", [
    encodePrincipal(owner),
    encodeUint(seq),
  ]);
}

// ============================================================================
// TASK BOARD READERS
// ============================================================================

export async function getTask(
  config: AgentSDKConfig,
  id: bigint
): Promise<ClarityValue | null> {
  return callReadOnly(config, "task-board", "get-task", [encodeUint(id)]);
}

export async function getBid(
  config: AgentSDKConfig,
  taskId: bigint,
  bidder: string
): Promise<ClarityValue | null> {
  return callReadOnly(config, "task-board", "get-bid", [
    encodeUint(taskId),
    encodePrincipal(bidder),
  ]);
}

export async function getBidAt(
  config: AgentSDKConfig,
  taskId: bigint,
  index: number
): Promise<ClarityValue | null> {
  return callReadOnly(config, "task-board", "get-bid-at", [
    encodeUint(taskId),
    encodeUint(index),
  ]);
}

export async function getBidCount(
  config: AgentSDKConfig,
  taskId: bigint
): Promise<ClarityValue | null> {
  return callReadOnly(config, "task-board", "get-bid-count", [
    encodeUint(taskId),
  ]);
}

export async function getAttestation(
  config: AgentSDKConfig,
  taskId: bigint
): Promise<ClarityValue | null> {
  return callReadOnly(config, "task-board", "get-attestation", [
    encodeUint(taskId),
  ]);
}

export async function getTaskStats(
  config: AgentSDKConfig
): Promise<ClarityValue | null> {
  return callReadOnly(config, "task-board", "get-stats");
}

export async function getFeeBps(
  config: AgentSDKConfig
): Promise<ClarityValue | null> {
  return callReadOnly(config, "task-board", "get-fee-bps");
}

// ============================================================================
// REPUTATION READERS
// ============================================================================

export async function getReputation(
  config: AgentSDKConfig,
  agent: string
): Promise<ClarityValue | null> {
  return callReadOnly(config, "reputation", "get-reputation", [
    encodePrincipal(agent),
  ]);
}

export async function getRating(
  config: AgentSDKConfig,
  taskId: bigint,
  rater: string
): Promise<ClarityValue | null> {
  return callReadOnly(config, "reputation", "get-rating", [
    encodeUint(taskId),
    encodePrincipal(rater),
  ]);
}

export async function getEndorsement(
  config: AgentSDKConfig,
  endorser: string,
  agent: string
): Promise<ClarityValue | null> {
  return callReadOnly(config, "reputation", "get-endorsement", [
    encodePrincipal(endorser),
    encodePrincipal(agent),
  ]);
}

export async function getAverageScore(
  config: AgentSDKConfig,
  agent: string
): Promise<ClarityValue | null> {
  return callReadOnly(config, "reputation", "get-average-score", [
    encodePrincipal(agent),
  ]);
}

export async function getTaskCompletion(
  config: AgentSDKConfig,
  taskId: bigint
): Promise<ClarityValue | null> {
  return callReadOnly(config, "reputation", "get-task-completion", [
    encodeUint(taskId),
  ]);
}
