import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

const contract = "agent-registry";

// Helper: register an agent for the given wallet (call at the start of any
// test that needs an already-registered agent so the block is self-contained)
function registerAgent(wallet: string, name = "TestAgent") {
  return simnet.callPublicFn(
    contract,
    "register-agent",
    [
      Cl.stringUtf8(name),
      Cl.stringUtf8("https://example.com/agent-description"),
      Cl.uint(1_000_000),
      Cl.bool(true),
      Cl.bool(false),
    ],
    wallet
  );
}

describe("agent-registry", () => {
  it("simnet is initialized", () => {
    expect(simnet.blockHeight).toBeDefined();
  });

  // ========================================================================
  // 1. REGISTER AGENT
  // ========================================================================

  describe("register-agent", () => {
    it("registers an agent with valid data", () => {
      const { result } = registerAgent(wallet1);

      expect(result).toBeOk(Cl.principal(wallet1));

      // Verify via get-agent
      const { result: agentResult } = simnet.callReadOnlyFn(
        contract,
        "get-agent",
        [Cl.principal(wallet1)],
        wallet1
      );

      expect(agentResult).toBeSome(
        Cl.tuple({
          name: Cl.stringUtf8("TestAgent"),
          "description-url": Cl.stringUtf8(
            "https://example.com/agent-description"
          ),
          status: Cl.uint(1),
          "registered-at": Cl.uint(
            (agentResult as any).value.value["registered-at"].value
          ),
          "total-tasks": Cl.uint(0),
          "total-earned": Cl.uint(0),
          "price-per-task": Cl.uint(1_000_000),
          "accepts-stx": Cl.bool(true),
          "accepts-sip010": Cl.bool(false),
        })
      );

      // Verify is-registered
      const { result: isReg } = simnet.callReadOnlyFn(
        contract,
        "is-registered",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(isReg).toBeBool(true);

      // Verify is-active
      const { result: isAct } = simnet.callReadOnlyFn(
        contract,
        "is-active",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(isAct).toBeBool(true);

      // Verify stats incremented
      const { result: stats } = simnet.callReadOnlyFn(
        contract,
        "get-stats",
        [],
        wallet1
      );
      const statsData = (stats as any).value;
      expect(Number(statsData["total-agents"].value)).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // 2. REJECT DUPLICATE REGISTRATION
  // ========================================================================

  describe("duplicate registration", () => {
    it("rejects duplicate registration with u1000", () => {
      // First registration succeeds
      const { result: first } = registerAgent(wallet1);
      expect(first).toBeOk(Cl.principal(wallet1));

      // Second registration with same wallet fails
      const { result } = simnet.callPublicFn(
        contract,
        "register-agent",
        [
          Cl.stringUtf8("DuplicateAgent"),
          Cl.stringUtf8("https://example.com/dup"),
          Cl.uint(500_000),
          Cl.bool(true),
          Cl.bool(true),
        ],
        wallet1
      );

      expect(result).toBeErr(Cl.uint(1000)); // ERR-ALREADY-REGISTERED
    });
  });

  // ========================================================================
  // 3. UPDATE AGENT METADATA
  // ========================================================================

  describe("update-agent", () => {
    it("updates agent metadata after registration", () => {
      // Register wallet1 first
      registerAgent(wallet1);

      // Now update it
      const { result } = simnet.callPublicFn(
        contract,
        "update-agent",
        [
          Cl.stringUtf8("UpdatedAgent"),
          Cl.stringUtf8("https://example.com/updated-description"),
          Cl.uint(2_000_000),
          Cl.bool(false),
          Cl.bool(true),
        ],
        wallet1
      );

      expect(result).toBeOk(Cl.bool(true));

      // Verify updated fields via get-agent
      const { result: agentResult } = simnet.callReadOnlyFn(
        contract,
        "get-agent",
        [Cl.principal(wallet1)],
        wallet1
      );

      const agentData = (agentResult as any).value.value;
      expect(agentData.name).toStrictEqual(Cl.stringUtf8("UpdatedAgent"));
      expect(agentData["description-url"]).toStrictEqual(
        Cl.stringUtf8("https://example.com/updated-description")
      );
      expect(agentData["price-per-task"]).toStrictEqual(Cl.uint(2_000_000));
      expect(agentData["accepts-stx"]).toStrictEqual(Cl.bool(false));
      expect(agentData["accepts-sip010"]).toStrictEqual(Cl.bool(true));

      // Status should remain active (unchanged by update)
      expect(agentData.status).toStrictEqual(Cl.uint(1));
    });

    it("rejects update from unregistered wallet", () => {
      // wallet3 is never registered -- no setup needed
      const { result } = simnet.callPublicFn(
        contract,
        "update-agent",
        [
          Cl.stringUtf8("Ghost"),
          Cl.stringUtf8("https://example.com/ghost"),
          Cl.uint(100),
          Cl.bool(true),
          Cl.bool(false),
        ],
        wallet3
      );

      expect(result).toBeErr(Cl.uint(1001)); // ERR-NOT-REGISTERED
    });
  });

  // ========================================================================
  // 4. SET / REMOVE CAPABILITIES
  // ========================================================================

  describe("capabilities", () => {
    it("sets and removes capabilities", () => {
      // Register wallet1 first
      registerAgent(wallet1);

      // Set capability at index 0
      const { result: r0 } = simnet.callPublicFn(
        contract,
        "set-capability",
        [Cl.uint(0), Cl.stringUtf8("code-review")],
        wallet1
      );
      expect(r0).toBeOk(Cl.bool(true));

      // Set capability at index 1
      const { result: r1 } = simnet.callPublicFn(
        contract,
        "set-capability",
        [Cl.uint(1), Cl.stringUtf8("smart-contract-audit")],
        wallet1
      );
      expect(r1).toBeOk(Cl.bool(true));

      // Verify capability at index 0
      const { result: cap0 } = simnet.callReadOnlyFn(
        contract,
        "get-capability",
        [Cl.principal(wallet1), Cl.uint(0)],
        wallet1
      );
      expect(cap0).toBeSome(
        Cl.tuple({ capability: Cl.stringUtf8("code-review") })
      );

      // Verify capability at index 1
      const { result: cap1 } = simnet.callReadOnlyFn(
        contract,
        "get-capability",
        [Cl.principal(wallet1), Cl.uint(1)],
        wallet1
      );
      expect(cap1).toBeSome(
        Cl.tuple({ capability: Cl.stringUtf8("smart-contract-audit") })
      );

      // Remove capability at index 0
      const { result: rm } = simnet.callPublicFn(
        contract,
        "remove-capability",
        [Cl.uint(0)],
        wallet1
      );
      expect(rm).toBeOk(Cl.bool(true));

      // Verify index 0 is now none
      const { result: cap0After } = simnet.callReadOnlyFn(
        contract,
        "get-capability",
        [Cl.principal(wallet1), Cl.uint(0)],
        wallet1
      );
      expect(cap0After).toBeNone();

      // Index 1 should still exist
      const { result: cap1After } = simnet.callReadOnlyFn(
        contract,
        "get-capability",
        [Cl.principal(wallet1), Cl.uint(1)],
        wallet1
      );
      expect(cap1After).toBeSome(
        Cl.tuple({ capability: Cl.stringUtf8("smart-contract-audit") })
      );
    });

    it("rejects capability index >= 8", () => {
      // Register wallet1 first (set-capability requires registration)
      registerAgent(wallet1);

      const { result } = simnet.callPublicFn(
        contract,
        "set-capability",
        [Cl.uint(8), Cl.stringUtf8("overflow")],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(1004)); // ERR-TOO-MANY-CAPS
    });
  });

  // ========================================================================
  // 5. ADD / REMOVE DELEGATES
  // ========================================================================

  describe("delegates", () => {
    it("adds and removes delegates", () => {
      // Register wallet1 first
      registerAgent(wallet1);

      // Add wallet2 as delegate for wallet1
      const { result: addResult } = simnet.callPublicFn(
        contract,
        "add-delegate",
        [Cl.principal(wallet2)],
        wallet1
      );
      expect(addResult).toBeOk(Cl.bool(true));

      // Verify is-delegate returns true
      const { result: isDel } = simnet.callReadOnlyFn(
        contract,
        "is-delegate",
        [Cl.principal(wallet1), Cl.principal(wallet2)],
        wallet1
      );
      expect(isDel).toBeBool(true);

      // Remove wallet2 as delegate
      const { result: rmResult } = simnet.callPublicFn(
        contract,
        "remove-delegate",
        [Cl.principal(wallet2)],
        wallet1
      );
      expect(rmResult).toBeOk(Cl.bool(true));

      // Verify is-delegate returns false after removal
      const { result: isDelAfter } = simnet.callReadOnlyFn(
        contract,
        "is-delegate",
        [Cl.principal(wallet1), Cl.principal(wallet2)],
        wallet1
      );
      expect(isDelAfter).toBeBool(false);
    });
  });

  // ========================================================================
  // 6. DELEGATE AUTHORIZATION CHECK
  // ========================================================================

  describe("delegate authorization", () => {
    it("is-delegate returns false for non-delegates", () => {
      // No registration needed -- is-delegate is read-only and returns false
      // for any unknown principal pair
      const { result } = simnet.callReadOnlyFn(
        contract,
        "is-delegate",
        [Cl.principal(wallet1), Cl.principal(wallet3)],
        wallet1
      );
      expect(result).toBeBool(false);

      // Also check for a completely unregistered owner
      const { result: r2 } = simnet.callReadOnlyFn(
        contract,
        "is-delegate",
        [Cl.principal(wallet3), Cl.principal(wallet1)],
        wallet1
      );
      expect(r2).toBeBool(false);
    });
  });

  // ========================================================================
  // 7. STATUS TRANSITIONS
  // ========================================================================

  describe("status transitions", () => {
    it("transitions active -> paused -> deregistered", () => {
      // Register wallet1 first (starts as active / status u1)
      registerAgent(wallet1);

      const { result: isActiveBefore } = simnet.callReadOnlyFn(
        contract,
        "is-active",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(isActiveBefore).toBeBool(true);

      // Pause the agent (status u2)
      const { result: r1 } = simnet.callPublicFn(
        contract,
        "set-status",
        [Cl.uint(2)],
        wallet1
      );
      expect(r1).toBeOk(Cl.uint(2));

      // Verify is-active returns false when paused
      const { result: isActivePaused } = simnet.callReadOnlyFn(
        contract,
        "is-active",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(isActivePaused).toBeBool(false);

      // Verify agent record shows paused status
      const { result: agentPaused } = simnet.callReadOnlyFn(
        contract,
        "get-agent",
        [Cl.principal(wallet1)],
        wallet1
      );
      const pausedData = (agentPaused as any).value.value;
      expect(pausedData.status).toStrictEqual(Cl.uint(2));

      // Deregister the agent (status u3)
      const { result: r2 } = simnet.callPublicFn(
        contract,
        "set-status",
        [Cl.uint(3)],
        wallet1
      );
      expect(r2).toBeOk(Cl.uint(3));

      // Verify is-active returns false when deregistered
      const { result: isActiveDeregistered } = simnet.callReadOnlyFn(
        contract,
        "is-active",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(isActiveDeregistered).toBeBool(false);

      // Verify agent record shows deregistered status
      const { result: agentDereg } = simnet.callReadOnlyFn(
        contract,
        "get-agent",
        [Cl.principal(wallet1)],
        wallet1
      );
      const deregData = (agentDereg as any).value.value;
      expect(deregData.status).toStrictEqual(Cl.uint(3));

      // Verify invalid status is rejected
      const { result: r3 } = simnet.callPublicFn(
        contract,
        "set-status",
        [Cl.uint(99)],
        wallet1
      );
      expect(r3).toBeErr(Cl.uint(1005)); // ERR-INVALID-STATUS
    });
  });

  // ========================================================================
  // 8. TWO-STEP ADMIN TRANSFER
  // ========================================================================

  describe("admin transfer", () => {
    it("two-step admin transfer from deployer to wallet1", () => {
      // Verify deployer is current admin
      const { result: adminBefore } = simnet.callReadOnlyFn(
        contract,
        "get-admin",
        [],
        deployer
      );
      expect(adminBefore).toBePrincipal(deployer);

      // Step 1: deployer initiates transfer to wallet1
      const { result: r1 } = simnet.callPublicFn(
        contract,
        "transfer-admin",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(r1).toBeOk(Cl.principal(wallet1));

      // Verify pending-admin is set
      const { result: pending } = simnet.callReadOnlyFn(
        contract,
        "get-pending-admin",
        [],
        deployer
      );
      expect(pending).toBeSome(Cl.principal(wallet1));

      // Wrong wallet cannot accept
      const { result: wrongAccept } = simnet.callPublicFn(
        contract,
        "accept-admin",
        [],
        wallet2
      );
      expect(wrongAccept).toBeErr(Cl.uint(1002)); // ERR-UNAUTHORIZED

      // Step 2: wallet1 accepts
      const { result: r2 } = simnet.callPublicFn(
        contract,
        "accept-admin",
        [],
        wallet1
      );
      expect(r2).toBeOk(Cl.principal(wallet1));

      // Verify wallet1 is now admin
      const { result: adminAfter } = simnet.callReadOnlyFn(
        contract,
        "get-admin",
        [],
        wallet1
      );
      expect(adminAfter).toBePrincipal(wallet1);

      // Verify pending-admin is cleared
      const { result: pendingAfter } = simnet.callReadOnlyFn(
        contract,
        "get-pending-admin",
        [],
        wallet1
      );
      expect(pendingAfter).toBeNone();

      // Old admin (deployer) can no longer initiate transfers
      const { result: r3 } = simnet.callPublicFn(
        contract,
        "transfer-admin",
        [Cl.principal(wallet3)],
        deployer
      );
      expect(r3).toBeErr(Cl.uint(1002)); // ERR-UNAUTHORIZED
    });
  });
});
