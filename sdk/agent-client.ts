/**
 * AI Agent Protocol — Client Module (Write Functions)
 *
 * Builds contract call arguments for all write operations across
 * agent-registry, agent-vault, task-board, and reputation contracts.
 *
 * These return the parameters needed for @stacks/transactions makeContractCall
 * or Leather wallet openContractCall.
 */

import type { AgentSDKConfig, AgentStatus } from "./agent-types.js";

// ============================================================================
// HELPERS
// ============================================================================

function contractId(config: AgentSDKConfig, name: string) {
  return {
    contractAddress: config.contractAddress,
    contractName: name,
  };
}

interface ContractCallArgs {
  contractAddress: string;
  contractName: string;
  functionName: string;
  functionArgs: Record<string, unknown>;
}

// ============================================================================
// AGENT REGISTRY
// ============================================================================

export function buildRegisterAgent(
  config: AgentSDKConfig,
  params: {
    name: string;
    descriptionUrl: string;
    pricePerTask: bigint;
    acceptsStx: boolean;
    acceptsSip010: boolean;
  }
): ContractCallArgs {
  return {
    ...contractId(config, "agent-registry"),
    functionName: "register-agent",
    functionArgs: {
      name: params.name,
      "description-url": params.descriptionUrl,
      "price-per-task": params.pricePerTask.toString(),
      "accepts-stx": params.acceptsStx,
      "accepts-sip010": params.acceptsSip010,
    },
  };
}

export function buildUpdateAgent(
  config: AgentSDKConfig,
  params: {
    name: string;
    descriptionUrl: string;
    pricePerTask: bigint;
    acceptsStx: boolean;
    acceptsSip010: boolean;
  }
): ContractCallArgs {
  return {
    ...contractId(config, "agent-registry"),
    functionName: "update-agent",
    functionArgs: {
      name: params.name,
      "description-url": params.descriptionUrl,
      "price-per-task": params.pricePerTask.toString(),
      "accepts-stx": params.acceptsStx,
      "accepts-sip010": params.acceptsSip010,
    },
  };
}

export function buildSetCapability(
  config: AgentSDKConfig,
  index: number,
  capability: string
): ContractCallArgs {
  return {
    ...contractId(config, "agent-registry"),
    functionName: "set-capability",
    functionArgs: {
      index: index.toString(),
      capability,
    },
  };
}

export function buildRemoveCapability(
  config: AgentSDKConfig,
  index: number
): ContractCallArgs {
  return {
    ...contractId(config, "agent-registry"),
    functionName: "remove-capability",
    functionArgs: { index: index.toString() },
  };
}

export function buildSetStatus(
  config: AgentSDKConfig,
  status: AgentStatus
): ContractCallArgs {
  return {
    ...contractId(config, "agent-registry"),
    functionName: "set-status",
    functionArgs: { "new-status": status.toString() },
  };
}

export function buildAddDelegate(
  config: AgentSDKConfig,
  delegate: string
): ContractCallArgs {
  return {
    ...contractId(config, "agent-registry"),
    functionName: "add-delegate",
    functionArgs: { delegate },
  };
}

export function buildRemoveDelegate(
  config: AgentSDKConfig,
  delegate: string
): ContractCallArgs {
  return {
    ...contractId(config, "agent-registry"),
    functionName: "remove-delegate",
    functionArgs: { delegate },
  };
}

// ============================================================================
// AGENT VAULT
// ============================================================================

export function buildCreateVault(
  config: AgentSDKConfig,
  params: {
    perTxCap: bigint;
    dailyCap: bigint;
    whitelistOnly: boolean;
  }
): ContractCallArgs {
  return {
    ...contractId(config, "agent-vault"),
    functionName: "create-vault",
    functionArgs: {
      "per-tx-cap": params.perTxCap.toString(),
      "daily-cap": params.dailyCap.toString(),
      "whitelist-only": params.whitelistOnly,
    },
  };
}

export function buildVaultDeposit(
  config: AgentSDKConfig,
  amount: bigint
): ContractCallArgs {
  return {
    ...contractId(config, "agent-vault"),
    functionName: "deposit",
    functionArgs: { amount: amount.toString() },
  };
}

export function buildVaultWithdraw(
  config: AgentSDKConfig,
  amount: bigint
): ContractCallArgs {
  return {
    ...contractId(config, "agent-vault"),
    functionName: "withdraw",
    functionArgs: { amount: amount.toString() },
  };
}

export function buildUpdatePolicy(
  config: AgentSDKConfig,
  params: {
    perTxCap: bigint;
    dailyCap: bigint;
    whitelistOnly: boolean;
  }
): ContractCallArgs {
  return {
    ...contractId(config, "agent-vault"),
    functionName: "update-policy",
    functionArgs: {
      "per-tx-cap": params.perTxCap.toString(),
      "daily-cap": params.dailyCap.toString(),
      "whitelist-only": params.whitelistOnly,
    },
  };
}

export function buildAddToWhitelist(
  config: AgentSDKConfig,
  target: string
): ContractCallArgs {
  return {
    ...contractId(config, "agent-vault"),
    functionName: "add-to-whitelist",
    functionArgs: { target },
  };
}

export function buildRemoveFromWhitelist(
  config: AgentSDKConfig,
  target: string
): ContractCallArgs {
  return {
    ...contractId(config, "agent-vault"),
    functionName: "remove-from-whitelist",
    functionArgs: { target },
  };
}

export function buildVaultSpend(
  config: AgentSDKConfig,
  params: {
    owner: string;
    amount: bigint;
    memo: string;
  }
): ContractCallArgs {
  return {
    ...contractId(config, "agent-vault"),
    functionName: "spend",
    functionArgs: {
      owner: params.owner,
      amount: params.amount.toString(),
      memo: params.memo,
    },
  };
}

// ============================================================================
// TASK BOARD
// ============================================================================

export function buildPostTask(
  config: AgentSDKConfig,
  params: {
    title: string;
    descriptionUrl: string;
    bounty: bigint;
    deadline: bigint;
  }
): ContractCallArgs {
  return {
    ...contractId(config, "task-board"),
    functionName: "post-task",
    functionArgs: {
      title: params.title,
      "description-url": params.descriptionUrl,
      bounty: params.bounty.toString(),
      deadline: params.deadline.toString(),
    },
  };
}

export function buildBid(
  config: AgentSDKConfig,
  params: {
    taskId: bigint;
    price: bigint;
    messageUrl: string;
  }
): ContractCallArgs {
  return {
    ...contractId(config, "task-board"),
    functionName: "bid",
    functionArgs: {
      "task-id": params.taskId.toString(),
      price: params.price.toString(),
      "message-url": params.messageUrl,
    },
  };
}

export function buildAssign(
  config: AgentSDKConfig,
  taskId: bigint,
  agent: string
): ContractCallArgs {
  return {
    ...contractId(config, "task-board"),
    functionName: "assign",
    functionArgs: {
      "task-id": taskId.toString(),
      agent,
    },
  };
}

export function buildSubmitWork(
  config: AgentSDKConfig,
  taskId: bigint,
  resultUrl: string
): ContractCallArgs {
  return {
    ...contractId(config, "task-board"),
    functionName: "submit-work",
    functionArgs: {
      "task-id": taskId.toString(),
      "result-url": resultUrl,
    },
  };
}

export function buildApprove(
  config: AgentSDKConfig,
  taskId: bigint
): ContractCallArgs {
  return {
    ...contractId(config, "task-board"),
    functionName: "approve",
    functionArgs: { "task-id": taskId.toString() },
  };
}

export function buildDispute(
  config: AgentSDKConfig,
  taskId: bigint,
  reasonUrl: string
): ContractCallArgs {
  return {
    ...contractId(config, "task-board"),
    functionName: "dispute",
    functionArgs: {
      "task-id": taskId.toString(),
      "reason-url": reasonUrl,
    },
  };
}

export function buildCancel(
  config: AgentSDKConfig,
  taskId: bigint
): ContractCallArgs {
  return {
    ...contractId(config, "task-board"),
    functionName: "cancel",
    functionArgs: { "task-id": taskId.toString() },
  };
}

export function buildExpireTask(
  config: AgentSDKConfig,
  taskId: bigint
): ContractCallArgs {
  return {
    ...contractId(config, "task-board"),
    functionName: "expire-task",
    functionArgs: { "task-id": taskId.toString() },
  };
}

// ============================================================================
// REPUTATION
// ============================================================================

export function buildRateAgent(
  config: AgentSDKConfig,
  params: {
    taskId: bigint;
    agent: string;
    score: number;
  }
): ContractCallArgs {
  return {
    ...contractId(config, "reputation"),
    functionName: "rate-agent",
    functionArgs: {
      "task-id": params.taskId.toString(),
      agent: params.agent,
      score: params.score.toString(),
    },
  };
}

export function buildEndorse(
  config: AgentSDKConfig,
  agent: string,
  capability: string
): ContractCallArgs {
  return {
    ...contractId(config, "reputation"),
    functionName: "endorse",
    functionArgs: { agent, capability },
  };
}

export function buildRevokeEndorsement(
  config: AgentSDKConfig,
  agent: string
): ContractCallArgs {
  return {
    ...contractId(config, "reputation"),
    functionName: "revoke-endorsement",
    functionArgs: { agent },
  };
}
