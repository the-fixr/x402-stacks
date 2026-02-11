import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;

const router = "x402-curve-router";
const launchpad = "agent-launchpad";
const registry = "agent-registry";

// Helper: register an agent
function registerAgent(owner: string, name = "TestAgent") {
  return simnet.callPublicFn(
    registry,
    "register-agent",
    [
      Cl.stringUtf8(name),
      Cl.stringUtf8("https://example.com"),
      Cl.uint(1_000_000),
      Cl.bool(true),
      Cl.bool(false),
    ],
    owner
  );
}

// Helper: register + launch a curve
function registerAndLaunch(owner: string, name = "TestToken", symbol = "TST") {
  registerAgent(owner);
  return simnet.callPublicFn(
    launchpad,
    "launch",
    [Cl.stringUtf8(name), Cl.stringUtf8(symbol)],
    owner
  );
}

// Helper: create a 16-byte nonce buffer from a numeric seed
function nonce(seed: number): ReturnType<typeof Cl.buffer> {
  const buf = new Uint8Array(16);
  buf[0] = (seed >> 24) & 0xff;
  buf[1] = (seed >> 16) & 0xff;
  buf[2] = (seed >> 8) & 0xff;
  buf[3] = seed & 0xff;
  return Cl.buffer(buf);
}

describe("x402-curve-router", () => {
  it("pay-via-curve buys tokens and records receipt", () => {
    registerAndLaunch(deployer);

    const result = simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(0), Cl.uint(1_000_000), nonce(1), Cl.uint(0)],
      wallet1
    );
    // Check result is Ok with tokens-received > 0
    const okVal = (result.result as any).value;
    expect(result.result.type).toBe(Cl.ok(Cl.uint(0)).type);
    expect(BigInt(okVal.value["tokens-received"].value)).toBeGreaterThan(0n);

    // Verify receipt exists
    const receipt = simnet.callReadOnlyFn(
      router,
      "verify-payment",
      [nonce(1)],
      deployer
    );
    expect(receipt.result.type).toBe(Cl.some(Cl.uint(0)).type);

    // Verify tokens were credited to wallet1
    const balance = simnet.callReadOnlyFn(
      launchpad,
      "get-balance",
      [Cl.uint(0), Cl.principal(wallet1)],
      deployer
    );
    const amt = (balance.result as any).value["amount"];
    expect(BigInt(amt.value)).toBeGreaterThan(0n);
  });

  it("nonce replay protection - same nonce fails", () => {
    registerAndLaunch(deployer);

    const r1 = simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(0), Cl.uint(1_000_000), nonce(100), Cl.uint(0)],
      wallet1
    );
    expect(r1.result.type).toBe(Cl.ok(Cl.uint(0)).type);

    // Same nonce fails
    const r2 = simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(0), Cl.uint(1_000_000), nonce(100), Cl.uint(0)],
      wallet1
    );
    expect(r2.result).toBeErr(Cl.uint(1500)); // ERR-NONCE-USED
  });

  it("different nonces succeed independently", () => {
    registerAndLaunch(deployer);

    const r1 = simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(0), Cl.uint(1_000_000), nonce(200), Cl.uint(0)],
      wallet1
    );
    expect(r1.result.type).toBe(Cl.ok(Cl.uint(0)).type);

    const r2 = simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(0), Cl.uint(1_000_000), nonce(201), Cl.uint(0)],
      wallet1
    );
    expect(r2.result.type).toBe(Cl.ok(Cl.uint(0)).type);
  });

  it("fails with zero amount", () => {
    registerAndLaunch(deployer);

    const result = simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(0), Cl.uint(0), nonce(300), Cl.uint(0)],
      wallet1
    );
    expect(result.result).toBeErr(Cl.uint(1501)); // ERR-ZERO-AMOUNT
  });

  it("fails below agent minimum price", () => {
    // Agent registers with price-per-task = 1_000_000 (1 STX)
    registerAndLaunch(deployer);

    // Try to pay only 0.5 STX - below the 1 STX minimum
    const result = simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(0), Cl.uint(500_000), nonce(350), Cl.uint(0)],
      wallet1
    );
    expect(result.result).toBeErr(Cl.uint(1504)); // ERR-BELOW-MINIMUM
  });

  it("succeeds at exact minimum price", () => {
    // Agent's price-per-task is 1_000_000 (1 STX)
    registerAndLaunch(deployer);

    // Pay exactly the minimum
    const result = simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(0), Cl.uint(1_000_000), nonce(351), Cl.uint(0)],
      wallet1
    );
    expect(result.result.type).toBe(Cl.ok(Cl.uint(0)).type);
  });

  it("succeeds above minimum - payer gets more tokens", () => {
    // Agent's price-per-task is 1_000_000 (1 STX)
    registerAndLaunch(deployer);

    // Pay 5x the minimum - should work, payer gets more tokens
    const result = simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(0), Cl.uint(5_000_000), nonce(352), Cl.uint(0)],
      wallet1
    );
    expect(result.result.type).toBe(Cl.ok(Cl.uint(0)).type);
    const tokensOut = BigInt((result.result as any).value.value["tokens-received"].value);
    expect(tokensOut).toBeGreaterThan(0n);
  });

  it("fails with invalid curve-id", () => {
    const result = simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(99), Cl.uint(1_000_000), nonce(400), Cl.uint(0)],
      wallet1
    );
    expect(result.result).toBeErr(Cl.uint(1502)); // ERR-CURVE-NOT-FOUND (router's own lookup)
  });

  it("respects slippage protection", () => {
    registerAndLaunch(deployer);

    const result = simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(0), Cl.uint(1_000_000), nonce(500), Cl.uint(999_999_999_999_999)],
      wallet1
    );
    expect(result.result).toBeErr(Cl.uint(1406)); // ERR-SLIPPAGE
  });

  it("stats update after payments", () => {
    registerAndLaunch(deployer);

    const r1 = simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(0), Cl.uint(2_000_000), nonce(601), Cl.uint(0)],
      wallet1
    );
    expect(r1.result.type).toBe(Cl.ok(Cl.uint(0)).type);

    const r2 = simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(0), Cl.uint(3_000_000), nonce(602), Cl.uint(0)],
      wallet1
    );
    expect(r2.result.type).toBe(Cl.ok(Cl.uint(0)).type);

    const stats = simnet.callReadOnlyFn(router, "get-stats", [], deployer);
    const s = (stats.result as any).value;
    expect(BigInt(s["total-payments"].value)).toBe(2n);
    expect(BigInt(s["total-volume-stx"].value)).toBe(5_000_000n);
  });

  it("is-nonce-available returns correct values", () => {
    registerAndLaunch(deployer);

    const before = simnet.callReadOnlyFn(
      router,
      "is-nonce-available",
      [nonce(700)],
      deployer
    );
    expect(before.result).toBeBool(true);

    simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(0), Cl.uint(1_000_000), nonce(700), Cl.uint(0)],
      wallet1
    );

    const after = simnet.callReadOnlyFn(
      router,
      "is-nonce-available",
      [nonce(700)],
      deployer
    );
    expect(after.result).toBeBool(false);
  });

  it("receipt contains correct payer and curve info", () => {
    registerAndLaunch(deployer);

    simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(0), Cl.uint(5_000_000), nonce(800), Cl.uint(0)],
      wallet2
    );

    const receipt = simnet.callReadOnlyFn(
      router,
      "verify-payment",
      [nonce(800)],
      deployer
    );

    const r = (receipt.result as any).value.value;
    expect(r["payer"].value).toBe(wallet2);
    expect(BigInt(r["curve-id"].value)).toBe(0n);
    expect(BigInt(r["stx-amount"].value)).toBe(5_000_000n);
    expect(BigInt(r["tokens-received"].value)).toBeGreaterThan(0n);
  });

  it("multiple payments accumulate token balance", () => {
    registerAndLaunch(deployer);

    const r1 = simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(0), Cl.uint(1_000_000), nonce(901), Cl.uint(0)],
      wallet1
    );
    expect(r1.result.type).toBe(Cl.ok(Cl.uint(0)).type);
    const tokens1 = BigInt((r1.result as any).value.value["tokens-received"].value);

    const r2 = simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(0), Cl.uint(2_000_000), nonce(902), Cl.uint(0)],
      wallet1
    );
    expect(r2.result.type).toBe(Cl.ok(Cl.uint(0)).type);
    const tokens2 = BigInt((r2.result as any).value.value["tokens-received"].value);

    const bal = simnet.callReadOnlyFn(
      launchpad,
      "get-balance",
      [Cl.uint(0), Cl.principal(wallet1)],
      deployer
    );
    const total = BigInt((bal.result as any).value["amount"].value);
    expect(total).toBe(tokens1 + tokens2);
    expect(total).toBeGreaterThan(0n);
  });

  it("fails on graduated curve", () => {
    registerAndLaunch(deployer);

    // Lower graduation threshold
    simnet.callPublicFn(
      launchpad,
      "set-defaults",
      [
        Cl.uint(1_000_000_000_000_000),
        Cl.uint(10_000_000_000),
        Cl.uint(100_000), // graduation at 0.1 STX
        Cl.uint(100),
        Cl.uint(8000),
      ],
      deployer
    );

    // Register wallet1 and launch with low graduation
    registerAgent(wallet1, "Agent2");
    simnet.callPublicFn(
      launchpad,
      "launch",
      [Cl.stringUtf8("LowGrad"), Cl.stringUtf8("LOW")],
      wallet1
    );

    // Big buy to trigger graduation on curve 1
    simnet.callPublicFn(
      launchpad,
      "buy",
      [Cl.uint(1), Cl.uint(1_000_000), Cl.uint(0)],
      wallet2
    );

    // Pay via curve on graduated curve should fail (amount >= min price)
    const result = simnet.callPublicFn(
      router,
      "pay-via-curve",
      [Cl.uint(1), Cl.uint(1_000_000), nonce(999), Cl.uint(0)],
      wallet2
    );
    expect(result.result).toBeErr(Cl.uint(1403)); // ERR-GRADUATED
  });
});
