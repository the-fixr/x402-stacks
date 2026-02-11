import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

const contract = "x402-payments";

// Helper: generate a random 16-byte nonce
function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    nonce[i] = Math.floor(Math.random() * 256);
  }
  return nonce;
}

describe("x402-payments", () => {
  it("simnet is initialized", () => {
    expect(simnet.blockHeight).toBeDefined();
  });

  // ========================================================================
  // PAY-STX
  // ========================================================================

  describe("pay-stx", () => {
    it("executes a basic STX payment", () => {
      const nonce = randomNonce();
      const amount = 1_000_000; // 1 STX

      const { result } = simnet.callPublicFn(
        contract,
        "pay-stx",
        [Cl.principal(wallet2), Cl.uint(amount), Cl.buffer(nonce)],
        wallet1
      );

      expect(result).toBeOk(
        Cl.tuple({
          payer: Cl.principal(wallet1),
          recipient: Cl.principal(wallet2),
          amount: Cl.uint(amount), // no fee, so net = gross
          fee: Cl.uint(0),
          nonce: Cl.buffer(nonce),
        })
      );
    });

    it("rejects duplicate nonce (replay protection)", () => {
      const nonce = randomNonce();
      const amount = 500_000;

      // First payment succeeds
      const { result: r1 } = simnet.callPublicFn(
        contract,
        "pay-stx",
        [Cl.principal(wallet2), Cl.uint(amount), Cl.buffer(nonce)],
        wallet1
      );
      expect(r1).toBeOk(Cl.tuple({
        payer: Cl.principal(wallet1),
        recipient: Cl.principal(wallet2),
        amount: Cl.uint(amount),
        fee: Cl.uint(0),
        nonce: Cl.buffer(nonce),
      }));

      // Second payment with same nonce fails
      const { result: r2 } = simnet.callPublicFn(
        contract,
        "pay-stx",
        [Cl.principal(wallet2), Cl.uint(amount), Cl.buffer(nonce)],
        wallet1
      );
      expect(r2).toBeErr(Cl.uint(100)); // ERR-NONCE-USED
    });

    it("rejects zero amount", () => {
      const nonce = randomNonce();

      const { result } = simnet.callPublicFn(
        contract,
        "pay-stx",
        [Cl.principal(wallet2), Cl.uint(0), Cl.buffer(nonce)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(101)); // ERR-ZERO-AMOUNT
    });

    it("rejects self-payment", () => {
      const nonce = randomNonce();

      const { result } = simnet.callPublicFn(
        contract,
        "pay-stx",
        [Cl.principal(wallet1), Cl.uint(1_000_000), Cl.buffer(nonce)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(104)); // ERR-SELF-PAYMENT
    });
  });

  // ========================================================================
  // VERIFY-PAYMENT
  // ========================================================================

  describe("verify-payment", () => {
    it("returns payment details for used nonce", () => {
      const nonce = randomNonce();
      const amount = 2_000_000;

      // Make payment
      simnet.callPublicFn(
        contract,
        "pay-stx",
        [Cl.principal(wallet2), Cl.uint(amount), Cl.buffer(nonce)],
        wallet1
      );

      // Verify
      const { result } = simnet.callReadOnlyFn(
        contract,
        "verify-payment",
        [Cl.buffer(nonce)],
        wallet1
      );

      // Structure: { type: "some", value: { type: "tuple", value: { field: ClarityValue } } }
      const payment = (result as any).value.value;
      expect(payment.payer).toStrictEqual(Cl.principal(wallet1));
      expect(payment.recipient).toStrictEqual(Cl.principal(wallet2));
      expect(payment.amount).toStrictEqual(Cl.uint(amount));
      expect(payment.fee).toStrictEqual(Cl.uint(0));
    });

    it("returns none for unused nonce", () => {
      const nonce = randomNonce();

      const { result } = simnet.callReadOnlyFn(
        contract,
        "verify-payment",
        [Cl.buffer(nonce)],
        wallet1
      );
      expect(result).toBeNone();
    });
  });

  // ========================================================================
  // IS-NONCE-AVAILABLE
  // ========================================================================

  describe("is-nonce-available", () => {
    it("returns true for unused nonce", () => {
      const nonce = randomNonce();

      const { result } = simnet.callReadOnlyFn(
        contract,
        "is-nonce-available",
        [Cl.buffer(nonce)],
        wallet1
      );
      expect(result).toBeBool(true);
    });

    it("returns false for used nonce", () => {
      const nonce = randomNonce();

      simnet.callPublicFn(
        contract,
        "pay-stx",
        [Cl.principal(wallet2), Cl.uint(1_000_000), Cl.buffer(nonce)],
        wallet1
      );

      const { result } = simnet.callReadOnlyFn(
        contract,
        "is-nonce-available",
        [Cl.buffer(nonce)],
        wallet1
      );
      expect(result).toBeBool(false);
    });
  });

  // ========================================================================
  // PROTOCOL FEE
  // ========================================================================

  describe("protocol fee", () => {
    it("admin can set fee", () => {
      const { result } = simnet.callPublicFn(
        contract,
        "set-fee",
        [Cl.uint(500)], // 5%
        deployer
      );
      expect(result).toBeOk(Cl.uint(500));

      // Verify
      const { result: feeResult } = simnet.callReadOnlyFn(
        contract,
        "get-fee-bps",
        [],
        deployer
      );
      expect(feeResult).toBeUint(500);
    });

    it("non-admin cannot set fee", () => {
      const { result } = simnet.callPublicFn(
        contract,
        "set-fee",
        [Cl.uint(500)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(102)); // ERR-UNAUTHORIZED
    });

    it("rejects fee above max (10%)", () => {
      const { result } = simnet.callPublicFn(
        contract,
        "set-fee",
        [Cl.uint(1001)], // > 1000
        deployer
      );
      expect(result).toBeErr(Cl.uint(103)); // ERR-INVALID-FEE
    });

    it("deducts fee from payment", () => {
      // Set 5% fee
      simnet.callPublicFn(contract, "set-fee", [Cl.uint(500)], deployer);

      // Set fee recipient
      simnet.callPublicFn(
        contract,
        "set-fee-recipient",
        [Cl.principal(wallet3)],
        deployer
      );

      const nonce = randomNonce();
      const amount = 1_000_000; // 1 STX
      const expectedFee = 50_000; // 5% of 1 STX
      const expectedNet = 950_000; // 95%

      const { result } = simnet.callPublicFn(
        contract,
        "pay-stx",
        [Cl.principal(wallet2), Cl.uint(amount), Cl.buffer(nonce)],
        wallet1
      );

      expect(result).toBeOk(
        Cl.tuple({
          payer: Cl.principal(wallet1),
          recipient: Cl.principal(wallet2),
          amount: Cl.uint(expectedNet),
          fee: Cl.uint(expectedFee),
          nonce: Cl.buffer(nonce),
        })
      );

      // Verify payment record stores gross amount
      const { result: verifyResult } = simnet.callReadOnlyFn(
        contract,
        "verify-payment",
        [Cl.buffer(nonce)],
        wallet1
      );

      const record = (verifyResult as any).value.value;
      expect(record.amount).toStrictEqual(Cl.uint(amount)); // gross
      expect(record.fee).toStrictEqual(Cl.uint(expectedFee));

      // Reset fee for other tests
      simnet.callPublicFn(contract, "set-fee", [Cl.uint(0)], deployer);
    });
  });

  // ========================================================================
  // ADMIN TRANSFER (TWO-STEP)
  // ========================================================================

  describe("admin transfer", () => {
    it("two-step admin transfer works", () => {
      // Step 1: deployer initiates transfer
      const { result: r1 } = simnet.callPublicFn(
        contract,
        "transfer-admin",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(r1).toBeOk(Cl.principal(wallet1));

      // Verify pending
      const { result: pending } = simnet.callReadOnlyFn(
        contract,
        "get-pending-admin",
        [],
        deployer
      );
      expect(pending).toBeSome(Cl.principal(wallet1));

      // Step 2: wallet1 accepts
      const { result: r2 } = simnet.callPublicFn(
        contract,
        "accept-admin",
        [],
        wallet1
      );
      expect(r2).toBeOk(Cl.principal(wallet1));

      // Verify new admin
      const { result: admin } = simnet.callReadOnlyFn(
        contract,
        "get-admin",
        [],
        wallet1
      );
      expect(admin).toBePrincipal(wallet1);

      // Old admin can no longer set fee
      const { result: r3 } = simnet.callPublicFn(
        contract,
        "set-fee",
        [Cl.uint(100)],
        deployer
      );
      expect(r3).toBeErr(Cl.uint(102)); // ERR-UNAUTHORIZED

      // New admin can set fee
      const { result: r4 } = simnet.callPublicFn(
        contract,
        "set-fee",
        [Cl.uint(100)],
        wallet1
      );
      expect(r4).toBeOk(Cl.uint(100));

      // Transfer back to deployer for subsequent tests
      simnet.callPublicFn(contract, "transfer-admin", [Cl.principal(deployer)], wallet1);
      simnet.callPublicFn(contract, "accept-admin", [], deployer);
      simnet.callPublicFn(contract, "set-fee", [Cl.uint(0)], deployer);
    });

    it("wrong wallet cannot accept admin", () => {
      simnet.callPublicFn(
        contract,
        "transfer-admin",
        [Cl.principal(wallet1)],
        deployer
      );

      // wallet2 tries to accept (should fail)
      const { result } = simnet.callPublicFn(
        contract,
        "accept-admin",
        [],
        wallet2
      );
      expect(result).toBeErr(Cl.uint(102)); // ERR-UNAUTHORIZED

      // Clean up
      simnet.callPublicFn(contract, "accept-admin", [], wallet1);
      simnet.callPublicFn(contract, "transfer-admin", [Cl.principal(deployer)], wallet1);
      simnet.callPublicFn(contract, "accept-admin", [], deployer);
    });
  });

  // ========================================================================
  // STATS
  // ========================================================================

  describe("stats", () => {
    it("tracks payment count and volume", () => {
      const nonce1 = randomNonce();
      const nonce2 = randomNonce();

      // Get baseline
      const { result: before } = simnet.callReadOnlyFn(
        contract,
        "get-stats",
        [],
        deployer
      );

      // Make two payments
      simnet.callPublicFn(
        contract,
        "pay-stx",
        [Cl.principal(wallet2), Cl.uint(1_000_000), Cl.buffer(nonce1)],
        wallet1
      );
      simnet.callPublicFn(
        contract,
        "pay-stx",
        [Cl.principal(wallet1), Cl.uint(3_000_000), Cl.buffer(nonce2)],
        wallet2
      );

      const { result: after } = simnet.callReadOnlyFn(
        contract,
        "get-stats",
        [],
        deployer
      );

      // Stats should have increased
      // Tuple structure: { type: "tuple", value: { field: ClarityValue } }
      const beforeData = (before as any).value;
      const afterData = (after as any).value;

      const beforePayments = Number(beforeData["total-payments"].value);
      const afterPayments = Number(afterData["total-payments"].value);
      expect(afterPayments).toBe(beforePayments + 2);

      const beforeVolume = Number(beforeData["total-volume-stx"].value);
      const afterVolume = Number(afterData["total-volume-stx"].value);
      expect(afterVolume).toBe(beforeVolume + 4_000_000);
    });
  });

  // ========================================================================
  // MULTIPLE PAYMENTS (STRESS)
  // ========================================================================

  describe("multiple payments", () => {
    it("handles 10 sequential payments", () => {
      for (let i = 0; i < 10; i++) {
        const nonce = randomNonce();
        const { result } = simnet.callPublicFn(
          contract,
          "pay-stx",
          [Cl.principal(wallet2), Cl.uint(100_000), Cl.buffer(nonce)],
          wallet1
        );
        expect(result).toBeOk(
          Cl.tuple({
            payer: Cl.principal(wallet1),
            recipient: Cl.principal(wallet2),
            amount: Cl.uint(100_000),
            fee: Cl.uint(0),
            nonce: Cl.buffer(nonce),
          })
        );
      }
    });
  });
});
