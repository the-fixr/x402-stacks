import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

// ---------------------------------------------------------------------------
// Helpers -- each test starts from a completely fresh simnet, so every helper
// re-executes the prerequisite transactions from scratch.
// ---------------------------------------------------------------------------

/** Set the task-board-contract to deployer so deployer can call record-completion / record-dispute directly. */
function setupReputationTaskBoard() {
  const { result } = simnet.callPublicFn(
    "reputation",
    "set-task-board",
    [Cl.principal(deployer)],
    deployer
  );
  expect(result).toBeOk(Cl.principal(deployer));
}

/** Register an agent in agent-registry. */
function registerAgent(owner: string, name: string) {
  return simnet.callPublicFn(
    "agent-registry",
    "register-agent",
    [
      Cl.stringUtf8(name),
      Cl.stringUtf8("https://example.com/agent"),
      Cl.uint(1000),
      Cl.bool(true),
      Cl.bool(false),
    ],
    owner
  );
}

/** Record a task completion: agent completed task-id for poster. Requires setupReputationTaskBoard() first. */
function recordCompletion(taskId: number, agent: string, poster: string) {
  const { result } = simnet.callPublicFn(
    "reputation",
    "record-completion",
    [Cl.uint(taskId), Cl.principal(agent), Cl.principal(poster)],
    deployer
  );
  expect(result).toBeOk(Cl.bool(true));
}

describe("reputation", () => {
  // ========================================================================
  // 1. Record completion from authorized caller
  // ========================================================================
  it("records completion from authorized caller", () => {
    // Setup: set task-board-contract to deployer
    setupReputationTaskBoard();

    // Deployer calls record-completion for task 0
    const { result } = simnet.callPublicFn(
      "reputation",
      "record-completion",
      [Cl.uint(0), Cl.principal(wallet2), Cl.principal(wallet1)],
      deployer
    );
    expect(result).toBeOk(Cl.bool(true));

    // Verify reputation was updated
    const { result: rep } = simnet.callReadOnlyFn(
      "reputation",
      "get-reputation",
      [Cl.principal(wallet2)],
      deployer
    );
    const repData = (rep as any).value.value;
    expect(repData["tasks-completed"]).toStrictEqual(Cl.uint(1));

    // Verify task-completion record exists
    const { result: completion } = simnet.callReadOnlyFn(
      "reputation",
      "get-task-completion",
      [Cl.uint(0)],
      deployer
    );
    const completionData = (completion as any).value.value;
    expect(completionData.agent).toStrictEqual(Cl.principal(wallet2));
    expect(completionData.poster).toStrictEqual(Cl.principal(wallet1));
  });

  // ========================================================================
  // 2. Rate agent (1-5) after completion
  // ========================================================================
  it("rates agent after completion", () => {
    // Setup: set task-board, record completion for task 0
    setupReputationTaskBoard();
    recordCompletion(0, wallet2, wallet1);

    // wallet1 (poster) rates wallet2 (agent) with score 4
    const { result } = simnet.callPublicFn(
      "reputation",
      "rate-agent",
      [Cl.uint(0), Cl.principal(wallet2), Cl.uint(4)],
      wallet1
    );
    expect(result).toBeOk(Cl.bool(true));

    // Verify rating was stored
    const { result: rating } = simnet.callReadOnlyFn(
      "reputation",
      "get-rating",
      [Cl.uint(0), Cl.principal(wallet1)],
      wallet1
    );
    const ratingData = (rating as any).value.value;
    expect(ratingData.agent).toStrictEqual(Cl.principal(wallet2));
    expect(ratingData.score).toStrictEqual(Cl.uint(4));
  });

  // ========================================================================
  // 3. Reject duplicate rating (u1301)
  // ========================================================================
  it("rejects duplicate rating with u1301", () => {
    // Setup: set task-board, record completion for task 0
    setupReputationTaskBoard();
    recordCompletion(0, wallet2, wallet1);

    // First rating succeeds
    const { result: r1 } = simnet.callPublicFn(
      "reputation",
      "rate-agent",
      [Cl.uint(0), Cl.principal(wallet2), Cl.uint(5)],
      wallet1
    );
    expect(r1).toBeOk(Cl.bool(true));

    // Second rating on same task fails with ERR-ALREADY-RATED
    const { result: r2 } = simnet.callPublicFn(
      "reputation",
      "rate-agent",
      [Cl.uint(0), Cl.principal(wallet2), Cl.uint(3)],
      wallet1
    );
    expect(r2).toBeErr(Cl.uint(1301));
  });

  // ========================================================================
  // 4. Reject rating without attestation (u1305)
  // ========================================================================
  it("rejects rating without attestation with u1305", () => {
    // No setup needed -- task 0 has no completion record in a fresh simnet
    const { result } = simnet.callPublicFn(
      "reputation",
      "rate-agent",
      [Cl.uint(0), Cl.principal(wallet2), Cl.uint(4)],
      wallet1
    );
    expect(result).toBeErr(Cl.uint(1305));
  });

  // ========================================================================
  // 5. Endorse agent capability (both agents must be registered)
  // ========================================================================
  it("endorses agent capability", () => {
    // Setup: register both agents
    registerAgent(wallet1, "Agent Alpha");
    registerAgent(wallet2, "Agent Beta");

    // wallet1 endorses wallet2
    const { result } = simnet.callPublicFn(
      "reputation",
      "endorse",
      [Cl.principal(wallet2), Cl.stringUtf8("smart-contracts")],
      wallet1
    );
    expect(result).toBeOk(Cl.bool(true));

    // Verify endorsement was stored
    const { result: endorsement } = simnet.callReadOnlyFn(
      "reputation",
      "get-endorsement",
      [Cl.principal(wallet1), Cl.principal(wallet2)],
      wallet1
    );
    const endorsementData = (endorsement as any).value.value;
    expect(endorsementData.capability).toStrictEqual(
      Cl.stringUtf8("smart-contracts")
    );

    // Verify endorsement count incremented
    const { result: rep } = simnet.callReadOnlyFn(
      "reputation",
      "get-reputation",
      [Cl.principal(wallet2)],
      deployer
    );
    const repData = (rep as any).value.value;
    expect(repData["endorsement-count"]).toStrictEqual(Cl.uint(1));
  });

  // ========================================================================
  // 6. Revoke endorsement
  // ========================================================================
  it("revokes endorsement", () => {
    // Setup: register both agents, then endorse
    registerAgent(wallet1, "Agent Alpha");
    registerAgent(wallet2, "Agent Beta");

    // wallet1 endorses wallet2
    simnet.callPublicFn(
      "reputation",
      "endorse",
      [Cl.principal(wallet2), Cl.stringUtf8("defi")],
      wallet1
    );

    // Verify endorsement count is 1 before revocation
    const { result: repBefore } = simnet.callReadOnlyFn(
      "reputation",
      "get-reputation",
      [Cl.principal(wallet2)],
      deployer
    );
    const countBefore = Number(
      (repBefore as any).value.value["endorsement-count"].value
    );
    expect(countBefore).toBe(1);

    // Revoke endorsement
    const { result } = simnet.callPublicFn(
      "reputation",
      "revoke-endorsement",
      [Cl.principal(wallet2)],
      wallet1
    );
    expect(result).toBeOk(Cl.bool(true));

    // Verify endorsement is gone
    const { result: endorsement } = simnet.callReadOnlyFn(
      "reputation",
      "get-endorsement",
      [Cl.principal(wallet1), Cl.principal(wallet2)],
      wallet1
    );
    expect(endorsement).toBeNone();

    // Verify endorsement count decremented to 0
    const { result: repAfter } = simnet.callReadOnlyFn(
      "reputation",
      "get-reputation",
      [Cl.principal(wallet2)],
      deployer
    );
    const countAfter = Number(
      (repAfter as any).value.value["endorsement-count"].value
    );
    expect(countAfter).toBe(0);
  });

  // ========================================================================
  // 7. Record dispute increments counter
  // ========================================================================
  it("records dispute and increments counter", () => {
    // Setup: set task-board-contract to deployer
    setupReputationTaskBoard();

    // Fresh simnet: wallet2 has no reputation record yet, so disputes start at 0
    // Record dispute
    const { result } = simnet.callPublicFn(
      "reputation",
      "record-dispute",
      [Cl.principal(wallet2)],
      deployer
    );
    expect(result).toBeOk(Cl.bool(true));

    // Verify dispute count is 1
    const { result: repAfter } = simnet.callReadOnlyFn(
      "reputation",
      "get-reputation",
      [Cl.principal(wallet2)],
      deployer
    );
    const repData = (repAfter as any).value.value;
    expect(repData["tasks-disputed"]).toStrictEqual(Cl.uint(1));
  });

  // ========================================================================
  // 8. Average score computation (rate 3 tasks, check get-average-score)
  // ========================================================================
  it("computes average score across multiple ratings", () => {
    // Setup: set task-board, record 3 completions, rate all 3
    setupReputationTaskBoard();

    // Record 3 completions: agent=wallet3, poster=deployer, task-ids 0, 1, 2
    recordCompletion(0, wallet3, deployer);
    recordCompletion(1, wallet3, deployer);
    recordCompletion(2, wallet3, deployer);

    // Rate: task 0 = score 3, task 1 = score 4, task 2 = score 5
    simnet.callPublicFn(
      "reputation",
      "rate-agent",
      [Cl.uint(0), Cl.principal(wallet3), Cl.uint(3)],
      deployer
    );
    simnet.callPublicFn(
      "reputation",
      "rate-agent",
      [Cl.uint(1), Cl.principal(wallet3), Cl.uint(4)],
      deployer
    );
    simnet.callPublicFn(
      "reputation",
      "rate-agent",
      [Cl.uint(2), Cl.principal(wallet3), Cl.uint(5)],
      deployer
    );

    // Check average score: (3 + 4 + 5) / 3 = 4 (integer division)
    const { result } = simnet.callReadOnlyFn(
      "reputation",
      "get-average-score",
      [Cl.principal(wallet3)],
      deployer
    );
    expect(result).toBeSome(Cl.uint(4));
  });
});
