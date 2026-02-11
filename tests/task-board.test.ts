import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

// Helper: register an agent in agent-registry
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

// Helper: set reputation task-board-contract to the task-board contract principal
function setupReputationTaskBoard() {
  simnet.callPublicFn(
    "reputation",
    "set-task-board",
    [Cl.principal(deployer + ".task-board")],
    deployer
  );
}

// Helper: post a task from a given poster
function postTask(
  poster: string,
  title: string,
  bounty: number,
  deadline: number
) {
  return simnet.callPublicFn(
    "task-board",
    "post-task",
    [
      Cl.stringUtf8(title),
      Cl.stringUtf8("https://example.com/task-description"),
      Cl.uint(bounty),
      Cl.uint(deadline),
    ],
    poster
  );
}

// Helper: bid on a task
function bidOnTask(bidder: string, taskId: number, price: number) {
  return simnet.callPublicFn(
    "task-board",
    "bid",
    [
      Cl.uint(taskId),
      Cl.uint(price),
      Cl.stringUtf8("https://example.com/bid-message"),
    ],
    bidder
  );
}

describe("task-board", () => {
  // ========================================================================
  // 1. Post task with escrow
  // ========================================================================
  it("posts a task with escrow", () => {
    setupReputationTaskBoard();

    const bounty = 1_000_000; // 1 STX
    const deadline = 1000;

    const { result } = postTask(wallet1, "Build a website", bounty, deadline);
    expect(result).toBeOk(Cl.uint(0)); // first task id = 0

    // Verify task data via get-task
    const { result: taskResult } = simnet.callReadOnlyFn(
      "task-board",
      "get-task",
      [Cl.uint(0)],
      wallet1
    );
    const task = (taskResult as any).value.value;
    expect(task.poster).toStrictEqual(Cl.principal(wallet1));
    expect(task.bounty).toStrictEqual(Cl.uint(bounty));
    expect(task.status).toStrictEqual(Cl.uint(1)); // TASK-OPEN
    expect(task.fee).toStrictEqual(Cl.uint(0)); // fee-bps defaults to 0
  });

  // ========================================================================
  // 2. Bid on task (register agent, bid, check get-bid)
  // ========================================================================
  it("allows registered agent to bid on task", () => {
    setupReputationTaskBoard();
    registerAgent(wallet2, "Agent Bidder");

    // Post task (task id = 0)
    postTask(wallet1, "Design a logo", 500_000, 1000);

    // wallet2 bids on task 0
    const { result } = bidOnTask(wallet2, 0, 450_000);
    expect(result).toBeOk(Cl.bool(true));

    // Verify bid data
    const { result: bidResult } = simnet.callReadOnlyFn(
      "task-board",
      "get-bid",
      [Cl.uint(0), Cl.principal(wallet2)],
      wallet2
    );
    const bid = (bidResult as any).value.value;
    expect(bid.price).toStrictEqual(Cl.uint(450_000));
  });

  // ========================================================================
  // 3. Assign task to bidder
  // ========================================================================
  it("assigns task to bidder", () => {
    setupReputationTaskBoard();
    registerAgent(wallet3, "Agent Worker");

    // Post task (task id = 0)
    postTask(wallet1, "Write tests", 800_000, 1000);

    // wallet3 bids on task 0
    bidOnTask(wallet3, 0, 750_000);

    // wallet1 assigns wallet3
    const { result } = simnet.callPublicFn(
      "task-board",
      "assign",
      [Cl.uint(0), Cl.principal(wallet3)],
      wallet1
    );
    expect(result).toBeOk(Cl.bool(true));

    // Verify task status is ASSIGNED (u2)
    const { result: taskResult } = simnet.callReadOnlyFn(
      "task-board",
      "get-task",
      [Cl.uint(0)],
      wallet1
    );
    const task = (taskResult as any).value.value;
    expect(task.status).toStrictEqual(Cl.uint(2)); // TASK-ASSIGNED
    expect(task["assigned-to"]).toStrictEqual(
      Cl.some(Cl.principal(wallet3))
    );
  });

  // ========================================================================
  // 4. Submit work
  // ========================================================================
  it("allows assigned agent to submit work", () => {
    setupReputationTaskBoard();
    registerAgent(wallet3, "Agent Worker");

    // Post task (task id = 0)
    postTask(wallet1, "Audit contract", 900_000, 1000);

    // wallet3 bids and gets assigned
    bidOnTask(wallet3, 0, 850_000);
    simnet.callPublicFn(
      "task-board",
      "assign",
      [Cl.uint(0), Cl.principal(wallet3)],
      wallet1
    );

    // wallet3 submits work
    const { result } = simnet.callPublicFn(
      "task-board",
      "submit-work",
      [Cl.uint(0), Cl.stringUtf8("https://example.com/result")],
      wallet3
    );
    expect(result).toBeOk(Cl.bool(true));

    // Verify task status is SUBMITTED (u3)
    const { result: taskResult } = simnet.callReadOnlyFn(
      "task-board",
      "get-task",
      [Cl.uint(0)],
      wallet1
    );
    const task = (taskResult as any).value.value;
    expect(task.status).toStrictEqual(Cl.uint(3)); // TASK-SUBMITTED
  });

  // ========================================================================
  // 5. Approve work (bounty to agent, verify status = u4/COMPLETED)
  // ========================================================================
  it("approves work and pays bounty to agent", () => {
    setupReputationTaskBoard();
    registerAgent(wallet2, "Agent Bidder");

    const bounty = 1_000_000;

    // Post task (task id = 0)
    postTask(wallet1, "Deploy contract", bounty, 1000);

    // wallet2 bids, gets assigned, submits work
    bidOnTask(wallet2, 0, 950_000);
    simnet.callPublicFn(
      "task-board",
      "assign",
      [Cl.uint(0), Cl.principal(wallet2)],
      wallet1
    );
    simnet.callPublicFn(
      "task-board",
      "submit-work",
      [Cl.uint(0), Cl.stringUtf8("https://example.com/deployed")],
      wallet2
    );

    // Get wallet2 STX balance before approval
    const balanceBefore = simnet.getAssetsMap().get("STX")!.get(wallet2)!;

    // wallet1 approves
    const { result } = simnet.callPublicFn(
      "task-board",
      "approve",
      [Cl.uint(0)],
      wallet1
    );
    expect(result).toBeOk(Cl.bool(true));

    // Verify task status is COMPLETED (u4)
    const { result: taskResult } = simnet.callReadOnlyFn(
      "task-board",
      "get-task",
      [Cl.uint(0)],
      wallet1
    );
    const task = (taskResult as any).value.value;
    expect(task.status).toStrictEqual(Cl.uint(4)); // TASK-COMPLETED

    // Verify wallet2 received the bounty
    const balanceAfter = simnet.getAssetsMap().get("STX")!.get(wallet2)!;
    expect(balanceAfter - balanceBefore).toBe(BigInt(bounty));
  });

  // ========================================================================
  // 6. Dispute within window
  // ========================================================================
  it("disputes submitted work within window", () => {
    setupReputationTaskBoard();
    registerAgent(wallet2, "Agent Bidder");

    // Post task (task id = 0)
    postTask(wallet1, "Research topic", 600_000, 1000);

    // wallet2 bids, gets assigned, submits work
    bidOnTask(wallet2, 0, 550_000);
    simnet.callPublicFn(
      "task-board",
      "assign",
      [Cl.uint(0), Cl.principal(wallet2)],
      wallet1
    );
    simnet.callPublicFn(
      "task-board",
      "submit-work",
      [Cl.uint(0), Cl.stringUtf8("https://example.com/research")],
      wallet2
    );

    // wallet1 disputes
    const { result } = simnet.callPublicFn(
      "task-board",
      "dispute",
      [Cl.uint(0), Cl.stringUtf8("https://example.com/dispute-reason")],
      wallet1
    );
    expect(result).toBeOk(Cl.bool(true));

    // Verify task status is DISPUTED (u5)
    const { result: taskResult } = simnet.callReadOnlyFn(
      "task-board",
      "get-task",
      [Cl.uint(0)],
      wallet1
    );
    const task = (taskResult as any).value.value;
    expect(task.status).toStrictEqual(Cl.uint(5)); // TASK-DISPUTED
  });

  // ========================================================================
  // 7. Resolve dispute with split (admin resolves)
  // ========================================================================
  it("resolves dispute with split", () => {
    setupReputationTaskBoard();
    registerAgent(wallet2, "Agent Bidder");

    const bounty = 1_000_000;

    // Post task (task id = 0)
    postTask(wallet1, "Write whitepaper", bounty, 1000);

    // wallet2 bids, gets assigned, submits, poster disputes
    bidOnTask(wallet2, 0, 900_000);
    simnet.callPublicFn(
      "task-board",
      "assign",
      [Cl.uint(0), Cl.principal(wallet2)],
      wallet1
    );
    simnet.callPublicFn(
      "task-board",
      "submit-work",
      [Cl.uint(0), Cl.stringUtf8("https://example.com/whitepaper")],
      wallet2
    );
    simnet.callPublicFn(
      "task-board",
      "dispute",
      [Cl.uint(0), Cl.stringUtf8("https://example.com/dispute")],
      wallet1
    );

    // Get balances before resolution
    const agentBefore = simnet.getAssetsMap().get("STX")!.get(wallet2)!;
    const posterBefore = simnet.getAssetsMap().get("STX")!.get(wallet1)!;

    // Admin (deployer) resolves: 60% to agent, 40% refund to poster
    const payAgent = 600_000;
    const refundPoster = 400_000;

    const { result } = simnet.callPublicFn(
      "task-board",
      "resolve-dispute",
      [Cl.uint(0), Cl.uint(payAgent), Cl.uint(refundPoster)],
      deployer
    );
    expect(result).toBeOk(Cl.bool(true));

    // Verify balances changed correctly
    const agentAfter = simnet.getAssetsMap().get("STX")!.get(wallet2)!;
    const posterAfter = simnet.getAssetsMap().get("STX")!.get(wallet1)!;

    expect(agentAfter - agentBefore).toBe(BigInt(payAgent));
    expect(posterAfter - posterBefore).toBe(BigInt(refundPoster));

    // Verify task status is COMPLETED (u4) after resolution
    const { result: taskResult } = simnet.callReadOnlyFn(
      "task-board",
      "get-task",
      [Cl.uint(0)],
      wallet1
    );
    const task = (taskResult as any).value.value;
    expect(task.status).toStrictEqual(Cl.uint(4)); // TASK-COMPLETED
  });

  // ========================================================================
  // 8. Cancel open task - refund
  // ========================================================================
  it("cancels open task and refunds escrow", () => {
    setupReputationTaskBoard();

    const bounty = 750_000;

    // Get wallet1 balance before posting
    const balanceBefore = simnet.getAssetsMap().get("STX")!.get(wallet1)!;

    // Post task (task id = 0)
    postTask(wallet1, "Cancelled task", bounty, 1000);

    // Balance should have decreased by bounty (fee=0)
    const balanceAfterPost = simnet.getAssetsMap().get("STX")!.get(wallet1)!;
    expect(balanceBefore - balanceAfterPost).toBe(BigInt(bounty));

    // Cancel task 0
    const { result } = simnet.callPublicFn(
      "task-board",
      "cancel",
      [Cl.uint(0)],
      wallet1
    );
    expect(result).toBeOk(Cl.bool(true));

    // Balance should be restored
    const balanceAfterCancel = simnet.getAssetsMap().get("STX")!.get(wallet1)!;
    expect(balanceAfterCancel).toBe(balanceBefore);

    // Verify task status is CANCELLED (u6)
    const { result: taskResult } = simnet.callReadOnlyFn(
      "task-board",
      "get-task",
      [Cl.uint(0)],
      wallet1
    );
    const task = (taskResult as any).value.value;
    expect(task.status).toStrictEqual(Cl.uint(6)); // TASK-CANCELLED
  });

  // ========================================================================
  // 9. Expire past-deadline task
  // ========================================================================
  it("expires past-deadline task", () => {
    setupReputationTaskBoard();

    const bounty = 500_000;
    // Set deadline to current block height (so it's immediately expirable after mining blocks)
    const currentBlock = simnet.blockHeight;
    const deadline = currentBlock + 1;

    // Post task with tight deadline (task id = 0)
    postTask(wallet1, "Expiring task", bounty, deadline);

    // Mine blocks to pass deadline
    simnet.mineEmptyBlocks(5);

    // Anyone can expire the task
    const { result } = simnet.callPublicFn(
      "task-board",
      "expire-task",
      [Cl.uint(0)],
      wallet3
    );
    expect(result).toBeOk(Cl.bool(true));

    // Verify task status is EXPIRED (u7)
    const { result: taskResult } = simnet.callReadOnlyFn(
      "task-board",
      "get-task",
      [Cl.uint(0)],
      wallet1
    );
    const task = (taskResult as any).value.value;
    expect(task.status).toStrictEqual(Cl.uint(7)); // TASK-EXPIRED
  });

  // ========================================================================
  // 10. Reject bid from non-registered agent (u1207)
  // ========================================================================
  it("rejects bid from non-registered agent with u1207", () => {
    setupReputationTaskBoard();

    // Post task (task id = 0)
    postTask(wallet1, "Restricted task", 300_000, 1000);

    // Use an account that is NOT registered as an agent
    const wallet4 = accounts.get("wallet_4")!;

    const { result } = simnet.callPublicFn(
      "task-board",
      "bid",
      [
        Cl.uint(0),
        Cl.uint(250_000),
        Cl.stringUtf8("https://example.com/unregistered-bid"),
      ],
      wallet4
    );
    expect(result).toBeErr(Cl.uint(1207)); // ERR-NOT-REGISTERED
  });

  // ========================================================================
  // 11. Reject self-assignment (u1206)
  // ========================================================================
  it("rejects self-assignment with u1206", () => {
    setupReputationTaskBoard();

    // Register wallet1 as agent
    registerAgent(wallet1, "Agent Poster");

    // Post task from wallet1 (task id = 0)
    postTask(wallet1, "Self-assign attempt", 400_000, 1000);

    // wallet1 tries to bid on own task -- should fail with ERR-SELF-ASSIGN
    const { result } = simnet.callPublicFn(
      "task-board",
      "bid",
      [
        Cl.uint(0),
        Cl.uint(350_000),
        Cl.stringUtf8("https://example.com/self-bid"),
      ],
      wallet1
    );
    expect(result).toBeErr(Cl.uint(1206)); // ERR-SELF-ASSIGN
  });

  // ========================================================================
  // 12. Full lifecycle: post -> bid -> assign -> submit -> approve -> rate
  // ========================================================================
  it("completes full lifecycle: post, bid, assign, submit, approve, rate", () => {
    setupReputationTaskBoard();
    registerAgent(wallet2, "Agent Bidder");

    const bounty = 2_000_000;

    // 1. Post task (task id = 0)
    const { result: postResult } = postTask(
      wallet1,
      "Full lifecycle task",
      bounty,
      1000
    );
    expect(postResult).toBeOk(Cl.uint(0));

    // 2. Bid (wallet2 registered above)
    const { result: bidResult } = bidOnTask(wallet2, 0, 1_800_000);
    expect(bidResult).toBeOk(Cl.bool(true));

    // 3. Assign
    const { result: assignResult } = simnet.callPublicFn(
      "task-board",
      "assign",
      [Cl.uint(0), Cl.principal(wallet2)],
      wallet1
    );
    expect(assignResult).toBeOk(Cl.bool(true));

    // 4. Submit
    const { result: submitResult } = simnet.callPublicFn(
      "task-board",
      "submit-work",
      [Cl.uint(0), Cl.stringUtf8("https://example.com/final-result")],
      wallet2
    );
    expect(submitResult).toBeOk(Cl.bool(true));

    // 5. Approve (triggers reputation.record-completion)
    const { result: approveResult } = simnet.callPublicFn(
      "task-board",
      "approve",
      [Cl.uint(0)],
      wallet1
    );
    expect(approveResult).toBeOk(Cl.bool(true));

    // 6. Rate (poster rates agent via reputation contract)
    const { result: rateResult } = simnet.callPublicFn(
      "reputation",
      "rate-agent",
      [Cl.uint(0), Cl.principal(wallet2), Cl.uint(5)],
      wallet1
    );
    expect(rateResult).toBeOk(Cl.bool(true));

    // Verify final task status
    const { result: taskResult } = simnet.callReadOnlyFn(
      "task-board",
      "get-task",
      [Cl.uint(0)],
      wallet1
    );
    const task = (taskResult as any).value.value;
    expect(task.status).toStrictEqual(Cl.uint(4)); // TASK-COMPLETED

    // Verify rating was recorded
    const { result: ratingResult } = simnet.callReadOnlyFn(
      "reputation",
      "get-rating",
      [Cl.uint(0), Cl.principal(wallet1)],
      wallet1
    );
    const rating = (ratingResult as any).value.value;
    expect(rating.score).toStrictEqual(Cl.uint(5));
    expect(rating.agent).toStrictEqual(Cl.principal(wallet2));
  });
});
