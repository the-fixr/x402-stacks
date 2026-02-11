import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

const contract = "agent-vault";

// Helper: register an agent in agent-registry (required before vault creation)
function registerAgent(sender: string) {
  return simnet.callPublicFn(
    "agent-registry",
    "register-agent",
    [
      Cl.stringUtf8("TestAgent"),
      Cl.stringUtf8("https://example.com"),
      Cl.uint(1000000),
      Cl.bool(true),
      Cl.bool(false),
    ],
    sender
  );
}

// Helper: register agent + create vault + deposit in one shot
function setupFundedVault(
  owner: string,
  depositAmount: number,
  perTxCap: number = FIVE_STX,
  dailyCap: number = TWENTY_STX,
  whitelistOnly: boolean = false
) {
  registerAgent(owner);
  simnet.callPublicFn(
    contract,
    "create-vault",
    [Cl.uint(perTxCap), Cl.uint(dailyCap), Cl.bool(whitelistOnly)],
    owner
  );
  if (depositAmount > 0) {
    simnet.callPublicFn(contract, "deposit", [Cl.uint(depositAmount)], owner);
  }
}

// Microstack constants for readability
const ONE_STX = 1_000_000;
const THREE_STX = 3_000_000;
const FIVE_STX = 5_000_000;
const TEN_STX = 10_000_000;
const TWENTY_STX = 20_000_000;

describe("agent-vault", () => {
  it("simnet is initialized", () => {
    expect(simnet.blockHeight).toBeDefined();
  });

  // ========================================================================
  // 1. CREATE VAULT WITH POLICY
  // ========================================================================

  describe("create-vault", () => {
    it("creates a vault with policy after agent registration", () => {
      // Register agent first
      const { result: regResult } = registerAgent(wallet1);
      expect(regResult).toBeOk(Cl.principal(wallet1));

      // Create vault with 5 STX per-tx cap, 20 STX daily cap, whitelist-only off
      const { result } = simnet.callPublicFn(
        contract,
        "create-vault",
        [Cl.uint(FIVE_STX), Cl.uint(TWENTY_STX), Cl.bool(false)],
        wallet1
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify vault via read-only get-vault
      const { result: vaultResult } = simnet.callReadOnlyFn(
        contract,
        "get-vault",
        [Cl.principal(wallet1)],
        wallet1
      );

      const vault = (vaultResult as any).value.value;
      expect(vault.balance).toStrictEqual(Cl.uint(0));
      expect(vault["per-tx-cap"]).toStrictEqual(Cl.uint(FIVE_STX));
      expect(vault["daily-cap"]).toStrictEqual(Cl.uint(TWENTY_STX));
      expect(vault["whitelist-only"]).toStrictEqual(Cl.bool(false));
    });

    it("rejects vault creation without agent registration (u1108)", () => {
      // wallet3 is not registered as an agent -- fresh simnet, no setup needed
      const { result } = simnet.callPublicFn(
        contract,
        "create-vault",
        [Cl.uint(FIVE_STX), Cl.uint(TWENTY_STX), Cl.bool(false)],
        wallet3
      );
      expect(result).toBeErr(Cl.uint(1108)); // ERR-AGENT-NOT-REGISTERED
    });

    it("rejects duplicate vault creation (u1101)", () => {
      // Register and create vault for wallet1 from scratch
      registerAgent(wallet1);
      simnet.callPublicFn(
        contract,
        "create-vault",
        [Cl.uint(FIVE_STX), Cl.uint(TWENTY_STX), Cl.bool(false)],
        wallet1
      );

      // Try to create a second vault -- should fail
      const { result } = simnet.callPublicFn(
        contract,
        "create-vault",
        [Cl.uint(FIVE_STX), Cl.uint(TWENTY_STX), Cl.bool(false)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(1101)); // ERR-VAULT-EXISTS
    });
  });

  // ========================================================================
  // 2. DEPOSIT STX
  // ========================================================================

  describe("deposit", () => {
    it("deposits STX into vault and updates balance", () => {
      // Setup: register agent + create vault from scratch
      registerAgent(wallet1);
      simnet.callPublicFn(
        contract,
        "create-vault",
        [Cl.uint(FIVE_STX), Cl.uint(TWENTY_STX), Cl.bool(false)],
        wallet1
      );

      // Deposit 10 STX
      const { result } = simnet.callPublicFn(
        contract,
        "deposit",
        [Cl.uint(TEN_STX)],
        wallet1
      );
      expect(result).toBeOk(Cl.uint(TEN_STX));

      // Verify balance increased
      const { result: vaultResult } = simnet.callReadOnlyFn(
        contract,
        "get-vault",
        [Cl.principal(wallet1)],
        wallet1
      );

      const vault = (vaultResult as any).value.value;
      expect(vault.balance).toStrictEqual(Cl.uint(TEN_STX));
    });

    it("rejects zero deposit (u1107)", () => {
      // Setup: register agent + create vault from scratch
      registerAgent(wallet1);
      simnet.callPublicFn(
        contract,
        "create-vault",
        [Cl.uint(FIVE_STX), Cl.uint(TWENTY_STX), Cl.bool(false)],
        wallet1
      );

      const { result } = simnet.callPublicFn(
        contract,
        "deposit",
        [Cl.uint(0)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(1107)); // ERR-ZERO-AMOUNT
    });
  });

  // ========================================================================
  // 3. WITHDRAW STX
  // ========================================================================

  describe("withdraw", () => {
    it("withdraws STX from vault and decreases balance", () => {
      // Setup: register + create vault + deposit 10 STX
      setupFundedVault(wallet1, TEN_STX);

      // Withdraw 3 STX
      const { result } = simnet.callPublicFn(
        contract,
        "withdraw",
        [Cl.uint(THREE_STX)],
        wallet1
      );
      expect(result).toBeOk(Cl.uint(THREE_STX));

      // Verify balance decreased to 7 STX
      const { result: vaultResult } = simnet.callReadOnlyFn(
        contract,
        "get-vault",
        [Cl.principal(wallet1)],
        wallet1
      );

      const vault = (vaultResult as any).value.value;
      expect(vault.balance).toStrictEqual(Cl.uint(TEN_STX - THREE_STX));
    });

    it("rejects withdrawal exceeding balance (u1105)", () => {
      // Setup: register + create vault + deposit 10 STX
      setupFundedVault(wallet1, TEN_STX);

      // Try to withdraw 20 STX (more than 10 STX balance)
      const { result } = simnet.callPublicFn(
        contract,
        "withdraw",
        [Cl.uint(TWENTY_STX)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(1105)); // ERR-INSUFFICIENT-FUNDS
    });

    it("rejects zero withdrawal (u1107)", () => {
      // Setup: register + create vault + deposit 10 STX
      setupFundedVault(wallet1, TEN_STX);

      const { result } = simnet.callPublicFn(
        contract,
        "withdraw",
        [Cl.uint(0)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(1107)); // ERR-ZERO-AMOUNT
    });
  });

  // ========================================================================
  // 4. SPEND WITHIN PER-TX CAP
  // ========================================================================

  describe("spend - per-tx cap", () => {
    it("allows spend within per-tx cap", () => {
      // Setup: register + create vault (5 STX per-tx, 20 STX daily) + deposit 20 STX
      setupFundedVault(wallet1, TWENTY_STX);

      // wallet2 spends 3 STX from wallet1's vault (within 5 STX per-tx cap)
      const { result } = simnet.callPublicFn(
        contract,
        "spend",
        [Cl.principal(wallet1), Cl.uint(THREE_STX), Cl.stringUtf8("test-spend")],
        wallet2
      );
      expect(result).toBeOk(Cl.uint(THREE_STX));

      // Verify balance decreased
      const { result: vaultResult } = simnet.callReadOnlyFn(
        contract,
        "get-vault",
        [Cl.principal(wallet1)],
        wallet1
      );

      const vault = (vaultResult as any).value.value;
      expect(vault.balance).toStrictEqual(Cl.uint(TWENTY_STX - THREE_STX));
    });

    it("rejects spend exceeding per-tx cap (u1103)", () => {
      // Setup: register + create vault (5 STX per-tx) + deposit 20 STX
      setupFundedVault(wallet1, TWENTY_STX);

      // Try to spend 6 STX (exceeds 5 STX per-tx cap)
      const { result } = simnet.callPublicFn(
        contract,
        "spend",
        [
          Cl.principal(wallet1),
          Cl.uint(6_000_000), // 6 STX > 5 STX cap
          Cl.stringUtf8("too-much"),
        ],
        wallet2
      );
      expect(result).toBeErr(Cl.uint(1103)); // ERR-EXCEEDED-TX-CAP
    });
  });

  // ========================================================================
  // 5. SPEND WITHIN DAILY CAP
  // ========================================================================

  describe("spend - daily cap", () => {
    it("allows multiple spends within daily cap", () => {
      // Setup: register + create vault (5 STX per-tx, 20 STX daily) + deposit 20 STX
      setupFundedVault(wallet1, TWENTY_STX);

      // Spend 4 STX four times (4*4=16 STX < 20 STX daily cap, each 4 < 5 per-tx)
      for (let i = 0; i < 4; i++) {
        const { result } = simnet.callPublicFn(
          contract,
          "spend",
          [
            Cl.principal(wallet1),
            Cl.uint(4_000_000), // 4 STX per spend
            Cl.stringUtf8(`multi-spend-${i}`),
          ],
          wallet2
        );
        expect(result).toBeOk(Cl.uint(4_000_000));
      }

      // Verify daily spent reflects the cumulative total
      const { result: vaultResult } = simnet.callReadOnlyFn(
        contract,
        "get-vault",
        [Cl.principal(wallet1)],
        wallet1
      );

      const vault = (vaultResult as any).value.value;
      // daily-spent should be 4 * 4 = 16 STX
      expect(vault["daily-spent"]).toStrictEqual(Cl.uint(16_000_000));
    });

    it("rejects spend that would exceed daily cap (u1104)", () => {
      // Setup: register + create vault (5 STX per-tx, 20 STX daily) + deposit 25 STX
      setupFundedVault(wallet1, 25_000_000);

      // Spend up to exactly the daily cap: 4 spends of 5 STX = 20 STX
      for (let i = 0; i < 4; i++) {
        const { result } = simnet.callPublicFn(
          contract,
          "spend",
          [
            Cl.principal(wallet1),
            Cl.uint(FIVE_STX),
            Cl.stringUtf8(`fill-cap-${i}`),
          ],
          wallet2
        );
        expect(result).toBeOk(Cl.uint(FIVE_STX));
      }

      // Now daily spent = 20 STX = daily cap. Any additional spend should fail.
      const { result } = simnet.callPublicFn(
        contract,
        "spend",
        [
          Cl.principal(wallet1),
          Cl.uint(ONE_STX),
          Cl.stringUtf8("over-daily"),
        ],
        wallet2
      );
      expect(result).toBeErr(Cl.uint(1104)); // ERR-EXCEEDED-DAILY-CAP
    });
  });

  // ========================================================================
  // 6. DAILY CAP RESETS AFTER 144 BLOCKS
  // ========================================================================

  describe("daily cap reset", () => {
    it("resets daily spent after BLOCKS-PER-DAY (144 blocks)", () => {
      // Setup: register + create vault (5 STX per-tx, 20 STX daily) + deposit 25 STX
      setupFundedVault(wallet1, 25_000_000);

      // Exhaust daily cap: 4 spends of 5 STX = 20 STX
      for (let i = 0; i < 4; i++) {
        simnet.callPublicFn(
          contract,
          "spend",
          [
            Cl.principal(wallet1),
            Cl.uint(FIVE_STX),
            Cl.stringUtf8(`exhaust-${i}`),
          ],
          wallet2
        );
      }

      // Confirm daily cap is exhausted
      const { result: blocked } = simnet.callPublicFn(
        contract,
        "spend",
        [
          Cl.principal(wallet1),
          Cl.uint(ONE_STX),
          Cl.stringUtf8("blocked"),
        ],
        wallet2
      );
      expect(blocked).toBeErr(Cl.uint(1104)); // ERR-EXCEEDED-DAILY-CAP

      // Mine 144 empty blocks to trigger daily reset
      simnet.mineEmptyBlocks(144);

      // Now spending should work again since daily counter resets
      const { result } = simnet.callPublicFn(
        contract,
        "spend",
        [
          Cl.principal(wallet1),
          Cl.uint(THREE_STX),
          Cl.stringUtf8("after-reset"),
        ],
        wallet2
      );
      expect(result).toBeOk(Cl.uint(THREE_STX));

      // Verify daily-spent was reset and now only shows the new spend
      const { result: vaultResult } = simnet.callReadOnlyFn(
        contract,
        "get-vault",
        [Cl.principal(wallet1)],
        wallet1
      );

      const vault = (vaultResult as any).value.value;
      // After reset, daily-spent should be just the new spend amount
      expect(vault["daily-spent"]).toStrictEqual(Cl.uint(THREE_STX));
    });
  });

  // ========================================================================
  // 7. WHITELIST ENFORCEMENT
  // ========================================================================

  describe("whitelist enforcement", () => {
    it("enforces whitelist-only mode and allows whitelisted spenders", () => {
      // Register wallet2 as an agent and create a vault with whitelist-only=true
      registerAgent(wallet2);

      const { result: createResult } = simnet.callPublicFn(
        contract,
        "create-vault",
        [Cl.uint(TEN_STX), Cl.uint(TWENTY_STX), Cl.bool(true)], // whitelist-only = true
        wallet2
      );
      expect(createResult).toBeOk(Cl.bool(true));

      // Deposit funds into wallet2's vault
      simnet.callPublicFn(contract, "deposit", [Cl.uint(TEN_STX)], wallet2);

      // wallet3 tries to spend from wallet2's vault - should fail (not whitelisted)
      const { result: failResult } = simnet.callPublicFn(
        contract,
        "spend",
        [
          Cl.principal(wallet2),
          Cl.uint(ONE_STX),
          Cl.stringUtf8("not-whitelisted"),
        ],
        wallet3
      );
      expect(failResult).toBeErr(Cl.uint(1106)); // ERR-NOT-WHITELISTED

      // wallet2 adds wallet3 to whitelist
      const { result: addResult } = simnet.callPublicFn(
        contract,
        "add-to-whitelist",
        [Cl.principal(wallet3)],
        wallet2
      );
      expect(addResult).toBeOk(Cl.bool(true));

      // Verify wallet3 is whitelisted
      const { result: isWhitelisted } = simnet.callReadOnlyFn(
        contract,
        "is-whitelisted",
        [Cl.principal(wallet2), Cl.principal(wallet3)],
        wallet2
      );
      expect(isWhitelisted).toBeBool(true);

      // Now wallet3 can spend from wallet2's vault
      const { result: successResult } = simnet.callPublicFn(
        contract,
        "spend",
        [
          Cl.principal(wallet2),
          Cl.uint(ONE_STX),
          Cl.stringUtf8("whitelisted-ok"),
        ],
        wallet3
      );
      expect(successResult).toBeOk(Cl.uint(ONE_STX));

      // Remove wallet3 from whitelist
      const { result: removeResult } = simnet.callPublicFn(
        contract,
        "remove-from-whitelist",
        [Cl.principal(wallet3)],
        wallet2
      );
      expect(removeResult).toBeOk(Cl.bool(true));

      // wallet3 should no longer be able to spend
      const { result: failAgain } = simnet.callPublicFn(
        contract,
        "spend",
        [
          Cl.principal(wallet2),
          Cl.uint(ONE_STX),
          Cl.stringUtf8("removed-from-wl"),
        ],
        wallet3
      );
      expect(failAgain).toBeErr(Cl.uint(1106)); // ERR-NOT-WHITELISTED
    });
  });

  // ========================================================================
  // 8. UPDATE POLICY
  // ========================================================================

  describe("update-policy", () => {
    it("updates vault spending policy", () => {
      // Setup: register + create vault from scratch
      registerAgent(wallet1);
      simnet.callPublicFn(
        contract,
        "create-vault",
        [Cl.uint(FIVE_STX), Cl.uint(TWENTY_STX), Cl.bool(false)],
        wallet1
      );

      const newPerTxCap = 8_000_000; // 8 STX
      const newDailyCap = 50_000_000; // 50 STX

      const { result } = simnet.callPublicFn(
        contract,
        "update-policy",
        [Cl.uint(newPerTxCap), Cl.uint(newDailyCap), Cl.bool(true)],
        wallet1
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify updated policy via get-vault
      const { result: vaultResult } = simnet.callReadOnlyFn(
        contract,
        "get-vault",
        [Cl.principal(wallet1)],
        wallet1
      );

      const vault = (vaultResult as any).value.value;
      expect(vault["per-tx-cap"]).toStrictEqual(Cl.uint(newPerTxCap));
      expect(vault["daily-cap"]).toStrictEqual(Cl.uint(newDailyCap));
      expect(vault["whitelist-only"]).toStrictEqual(Cl.bool(true));
    });

    it("rejects update-policy without a vault (u1100)", () => {
      // wallet3 has no vault -- fresh simnet, no setup needed
      const { result } = simnet.callPublicFn(
        contract,
        "update-policy",
        [Cl.uint(FIVE_STX), Cl.uint(TEN_STX), Cl.bool(false)],
        wallet3
      );
      expect(result).toBeErr(Cl.uint(1100)); // ERR-NO-VAULT
    });
  });

  // ========================================================================
  // SPEND LOG VERIFICATION
  // ========================================================================

  describe("spend-log", () => {
    it("records spend log entries with correct sequence", () => {
      // Setup: register + create vault + deposit + do a spend
      setupFundedVault(wallet1, TWENTY_STX);

      // Perform a spend so we have a log entry at seq 0
      simnet.callPublicFn(
        contract,
        "spend",
        [Cl.principal(wallet1), Cl.uint(THREE_STX), Cl.stringUtf8("test-spend")],
        wallet2
      );

      // Check the first log entry (seq 0)
      const { result: entry0 } = simnet.callReadOnlyFn(
        contract,
        "get-spend-log-entry",
        [Cl.principal(wallet1), Cl.uint(0)],
        wallet1
      );

      // Entry should exist
      const log = (entry0 as any).value.value;
      expect(log.spender).toStrictEqual(Cl.principal(wallet2));
      expect(log.amount).toStrictEqual(Cl.uint(THREE_STX));
      expect(log.memo).toStrictEqual(Cl.stringUtf8("test-spend"));
    });

    it("increments sequence number for multiple spends", () => {
      // Setup: register + create vault + deposit
      setupFundedVault(wallet1, TWENTY_STX);

      // Perform two spends
      simnet.callPublicFn(
        contract,
        "spend",
        [Cl.principal(wallet1), Cl.uint(ONE_STX), Cl.stringUtf8("first")],
        wallet2
      );
      simnet.callPublicFn(
        contract,
        "spend",
        [Cl.principal(wallet1), Cl.uint(THREE_STX), Cl.stringUtf8("second")],
        wallet3
      );

      // Check seq 0
      const { result: entry0 } = simnet.callReadOnlyFn(
        contract,
        "get-spend-log-entry",
        [Cl.principal(wallet1), Cl.uint(0)],
        wallet1
      );
      const log0 = (entry0 as any).value.value;
      expect(log0.spender).toStrictEqual(Cl.principal(wallet2));
      expect(log0.amount).toStrictEqual(Cl.uint(ONE_STX));
      expect(log0.memo).toStrictEqual(Cl.stringUtf8("first"));

      // Check seq 1
      const { result: entry1 } = simnet.callReadOnlyFn(
        contract,
        "get-spend-log-entry",
        [Cl.principal(wallet1), Cl.uint(1)],
        wallet1
      );
      const log1 = (entry1 as any).value.value;
      expect(log1.spender).toStrictEqual(Cl.principal(wallet3));
      expect(log1.amount).toStrictEqual(Cl.uint(THREE_STX));
      expect(log1.memo).toStrictEqual(Cl.stringUtf8("second"));
    });
  });

  // ========================================================================
  // AVAILABLE DAILY ALLOWANCE
  // ========================================================================

  describe("get-available-daily", () => {
    it("returns full daily allowance for fresh vault", () => {
      // Setup: register + create vault (daily cap = 20 STX), no spends yet
      registerAgent(wallet1);
      simnet.callPublicFn(
        contract,
        "create-vault",
        [Cl.uint(FIVE_STX), Cl.uint(TWENTY_STX), Cl.bool(false)],
        wallet1
      );

      const { result } = simnet.callReadOnlyFn(
        contract,
        "get-available-daily",
        [Cl.principal(wallet1)],
        wallet1
      );

      expect(result).toBeSome(Cl.uint(TWENTY_STX));
    });

    it("returns remaining daily allowance after spends", () => {
      // Setup: register + create vault + deposit + spend
      setupFundedVault(wallet1, TWENTY_STX);

      // Spend 3 STX
      simnet.callPublicFn(
        contract,
        "spend",
        [Cl.principal(wallet1), Cl.uint(THREE_STX), Cl.stringUtf8("test")],
        wallet2
      );

      const { result } = simnet.callReadOnlyFn(
        contract,
        "get-available-daily",
        [Cl.principal(wallet1)],
        wallet1
      );

      // 20 STX daily cap - 3 STX spent = 17 STX remaining
      expect(result).toBeSome(Cl.uint(TWENTY_STX - THREE_STX));
    });

    it("returns none for non-existent vault", () => {
      // wallet3 has no vault -- fresh simnet
      const { result } = simnet.callReadOnlyFn(
        contract,
        "get-available-daily",
        [Cl.principal(wallet3)],
        wallet3
      );
      expect(result).toBeNone();
    });
  });
});
