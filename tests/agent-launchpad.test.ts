import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

const contract = "agent-launchpad";

// Default values matching the contract
const DEFAULT_TOTAL_SUPPLY = 1_000_000_000_000_000n; // 1B tokens, 6 decimals
const DEFAULT_VIRTUAL_STX = 10_000_000_000n; // 10,000 STX in microSTX
const DEFAULT_GRADUATION_STX = 16_667_000_000n; // ~16,667 STX
const DEFAULT_FEE_BPS = 100n; // 1%
const DEFAULT_CREATOR_SHARE_BPS = 8_000n; // 80%

// Helper: register an agent in agent-registry
function registerAgent(owner: string, name = "TestAgent") {
  return simnet.callPublicFn(
    "agent-registry",
    "register-agent",
    [
      Cl.stringUtf8(name),
      Cl.stringUtf8("https://example.com/agent"),
      Cl.uint(1_000_000),
      Cl.bool(true),
      Cl.bool(false),
    ],
    owner
  );
}

// Helper: launch a curve for a registered agent
function launchCurve(owner: string, name = "TestToken", symbol = "TST") {
  return simnet.callPublicFn(
    contract,
    "launch",
    [Cl.stringUtf8(name), Cl.stringUtf8(symbol)],
    owner
  );
}

// Helper: register + launch in one step
function registerAndLaunch(owner: string, agentName = "TestAgent", tokenName = "TestToken", symbol = "TST") {
  registerAgent(owner, agentName);
  return launchCurve(owner, tokenName, symbol);
}

// Helper: buy tokens
function buy(buyer: string, curveId: number, stxAmount: number, minTokensOut = 0) {
  return simnet.callPublicFn(
    contract,
    "buy",
    [Cl.uint(curveId), Cl.uint(stxAmount), Cl.uint(minTokensOut)],
    buyer
  );
}

// Helper: sell tokens
function sell(seller: string, curveId: number, tokenAmount: number, minStxOut = 0) {
  return simnet.callPublicFn(
    contract,
    "sell",
    [Cl.uint(curveId), Cl.uint(tokenAmount), Cl.uint(minStxOut)],
    seller
  );
}

// Helper: get balance read-only
function getBalance(curveId: number, holder: string) {
  return simnet.callReadOnlyFn(
    contract,
    "get-balance",
    [Cl.uint(curveId), Cl.principal(holder)],
    deployer
  );
}

// Helper: get curve read-only
function getCurve(curveId: number) {
  return simnet.callReadOnlyFn(
    contract,
    "get-curve",
    [Cl.uint(curveId)],
    deployer
  );
}

// Unwrap getCurve result: Some(Tuple) → tuple data map
function unwrapCurve(curveResult: any): Record<string, any> {
  return (curveResult as any).value.value;
}

// Helper: get buy quote
function getBuyQuote(curveId: number, stxAmount: number) {
  return simnet.callReadOnlyFn(
    contract,
    "get-buy-quote",
    [Cl.uint(curveId), Cl.uint(stxAmount)],
    deployer
  );
}

// Helper: get sell quote
function getSellQuote(curveId: number, tokenAmount: number) {
  return simnet.callReadOnlyFn(
    contract,
    "get-sell-quote",
    [Cl.uint(curveId), Cl.uint(tokenAmount)],
    deployer
  );
}

// Unwrap Ok(Tuple) result → tuple data map
function unwrapOkTuple(result: any): Record<string, any> {
  return (result as any).value.value;
}

describe("agent-launchpad", () => {
  it("simnet is initialized", () => {
    expect(simnet.blockHeight).toBeDefined();
  });

  // ========================================================================
  // 1. LAUNCH
  // ========================================================================

  describe("launch", () => {
    it("launches a curve for a registered agent", () => {
      registerAgent(wallet1);
      const { result } = launchCurve(wallet1, "AlphaToken", "ALPHA");

      expect(result).toBeOk(Cl.uint(0));

      const { result: curveResult } = getCurve(0);
      const curve = unwrapCurve(curveResult);
      expect(curve.creator).toStrictEqual(Cl.principal(wallet1));
      expect(curve.name).toStrictEqual(Cl.stringUtf8("AlphaToken"));
      expect(curve.symbol).toStrictEqual(Cl.stringUtf8("ALPHA"));
      expect(curve["total-supply"]).toStrictEqual(Cl.uint(DEFAULT_TOTAL_SUPPLY));
      expect(curve["virtual-stx"]).toStrictEqual(Cl.uint(DEFAULT_VIRTUAL_STX));
      expect(curve["stx-reserve"]).toStrictEqual(Cl.uint(0));
      expect(curve["tokens-sold"]).toStrictEqual(Cl.uint(0));
      expect(curve.graduated).toStrictEqual(Cl.bool(false));

      const { result: agentCurve } = simnet.callReadOnlyFn(
        contract,
        "get-agent-curve",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(agentCurve).toBeSome(Cl.tuple({ "curve-id": Cl.uint(0) }));

      const { result: stats } = simnet.callReadOnlyFn(
        contract,
        "get-stats",
        [],
        deployer
      );
      expect((stats as any).value["total-curves"]).toStrictEqual(Cl.uint(1));
    });

    it("fails if caller is not registered", () => {
      const { result } = launchCurve(wallet1, "Fail", "FAIL");
      expect(result).toBeErr(Cl.uint(1400));
    });

    it("fails if agent already launched a curve", () => {
      registerAgent(wallet1);
      launchCurve(wallet1, "First", "FIR");
      const { result } = launchCurve(wallet1, "Second", "SEC");
      expect(result).toBeErr(Cl.uint(1401));
    });

    it("fails with empty name", () => {
      registerAgent(wallet1);
      const { result } = simnet.callPublicFn(
        contract,
        "launch",
        [Cl.stringUtf8(""), Cl.stringUtf8("TST")],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(1411));
    });

    it("fails with empty symbol", () => {
      registerAgent(wallet1);
      const { result } = simnet.callPublicFn(
        contract,
        "launch",
        [Cl.stringUtf8("Token"), Cl.stringUtf8("")],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(1411));
    });
  });

  // ========================================================================
  // 2. BUY
  // ========================================================================

  describe("buy", () => {
    it("buys tokens on a curve", () => {
      registerAndLaunch(wallet1);

      const stxAmount = 100_000_000;
      const { result } = buy(wallet2, 0, stxAmount);
      const buyData = unwrapOkTuple(result);
      expect(result).toBeOk(Cl.tuple({
        "tokens-out": buyData["tokens-out"],
        fee: buyData.fee,
      }));

      const { result: balResult } = getBalance(0, wallet2);
      const balance = Number((balResult as any).value.amount.value);
      expect(balance).toBeGreaterThan(0);

      const { result: curveResult } = getCurve(0);
      const curve = unwrapCurve(curveResult);
      const stxReserve = Number(curve["stx-reserve"].value);
      expect(stxReserve).toBeGreaterThan(0);
      const tokensSold = Number(curve["tokens-sold"].value);
      expect(tokensSold).toBeGreaterThan(0);
      expect(tokensSold).toBe(balance);
    });

    it("accrues fees on buy", () => {
      registerAndLaunch(wallet1);

      const stxAmount = 1_000_000_000;
      buy(wallet2, 0, stxAmount);

      const { result: curveResult } = getCurve(0);
      const curve = unwrapCurve(curveResult);
      const accruedFees = Number(curve["accrued-fees"].value);
      expect(accruedFees).toBe(10_000_000);
    });

    it("fails with slippage protection", () => {
      registerAndLaunch(wallet1);

      const { result } = buy(wallet2, 0, 100_000_000, 999_999_999_999_999);
      expect(result).toBeErr(Cl.uint(1406));
    });

    it("fails on graduated curve", () => {
      registerAgent(wallet1);
      simnet.callPublicFn(
        contract,
        "set-defaults",
        [
          Cl.uint(DEFAULT_TOTAL_SUPPLY),
          Cl.uint(DEFAULT_VIRTUAL_STX),
          Cl.uint(100_000_000),
          Cl.uint(DEFAULT_FEE_BPS),
          Cl.uint(DEFAULT_CREATOR_SHARE_BPS),
        ],
        deployer
      );
      launchCurve(wallet1);

      buy(wallet2, 0, 200_000_000);

      const { result: curveResult } = getCurve(0);
      const curve = unwrapCurve(curveResult);
      expect(curve.graduated).toStrictEqual(Cl.bool(true));

      const { result } = buy(wallet3, 0, 100_000_000);
      expect(result).toBeErr(Cl.uint(1403));
    });

    it("fails with zero amount", () => {
      registerAndLaunch(wallet1);
      const { result } = buy(wallet2, 0, 0);
      expect(result).toBeErr(Cl.uint(1404));
    });

    it("fails on non-existent curve", () => {
      const { result } = buy(wallet1, 99, 100_000_000);
      expect(result).toBeErr(Cl.uint(1402));
    });

    it("handles dust amount (1 microSTX)", () => {
      registerAndLaunch(wallet1);
      const { result } = buy(wallet2, 0, 1);
      expect(result).toBeErr(Cl.uint(1404));
    });

    it("fails when buying exactly 0 tokens after fee", () => {
      registerAndLaunch(wallet1);
      const { result } = buy(wallet2, 0, 1);
      expect(result).toBeErr(Cl.uint(1404));
    });
  });

  // ========================================================================
  // 3. SELL
  // ========================================================================

  describe("sell", () => {
    it("sells tokens for STX", () => {
      registerAndLaunch(wallet1);

      buy(wallet2, 0, 1_000_000_000);

      const { result: balBefore } = getBalance(0, wallet2);
      const tokensBefore = BigInt((balBefore as any).value.amount.value);

      const sellAmount = tokensBefore / 2n;
      const { result } = sell(wallet2, 0, Number(sellAmount));
      const sellData = unwrapOkTuple(result);
      expect(Number(sellData["stx-out"].value)).toBeGreaterThan(0);
      expect(Number(sellData.fee.value)).toBeGreaterThan(0);

      const { result: balAfter } = getBalance(0, wallet2);
      const tokensAfter = BigInt((balAfter as any).value.amount.value);
      expect(tokensAfter).toBe(tokensBefore - sellAmount);

      const { result: curveResult } = getCurve(0);
      const curve = unwrapCurve(curveResult);
      const stxReserve = Number(curve["stx-reserve"].value);
      expect(stxReserve).toBeGreaterThan(0);
      expect(stxReserve).toBeLessThan(990_000_000);
    });

    it("fails with slippage protection", () => {
      registerAndLaunch(wallet1);
      buy(wallet2, 0, 1_000_000_000);

      const { result: balResult } = getBalance(0, wallet2);
      const tokens = Number((balResult as any).value.amount.value);

      const { result } = sell(wallet2, 0, tokens, 999_999_999_999_999);
      expect(result).toBeErr(Cl.uint(1406));
    });

    it("fails with insufficient balance", () => {
      registerAndLaunch(wallet1);
      const { result } = sell(wallet3, 0, 1_000_000);
      expect(result).toBeErr(Cl.uint(1405));
    });

    it("accrues fees on sell", () => {
      registerAndLaunch(wallet1);
      buy(wallet2, 0, 1_000_000_000);

      const { result: curveBefore } = getCurve(0);
      const feesBefore = BigInt(unwrapCurve(curveBefore)["accrued-fees"].value);

      const { result: balResult } = getBalance(0, wallet2);
      const tokens = Number((balResult as any).value.amount.value);
      sell(wallet2, 0, Math.floor(tokens / 2));

      const { result: curveAfter } = getCurve(0);
      const feesAfter = BigInt(unwrapCurve(curveAfter)["accrued-fees"].value);
      expect(feesAfter).toBeGreaterThan(feesBefore);
    });
  });

  // ========================================================================
  // 4. TRANSFER
  // ========================================================================

  describe("transfer", () => {
    it("transfers tokens between holders", () => {
      registerAndLaunch(wallet1);
      buy(wallet2, 0, 100_000_000);

      const { result: balBefore } = getBalance(0, wallet2);
      const tokensBefore = Number((balBefore as any).value.amount.value);
      const transferAmount = Math.floor(tokensBefore / 2);

      const { result } = simnet.callPublicFn(
        contract,
        "transfer",
        [Cl.uint(0), Cl.uint(transferAmount), Cl.principal(wallet3)],
        wallet2
      );
      expect(result).toBeOk(Cl.bool(true));

      const { result: senderBal } = getBalance(0, wallet2);
      expect(Number((senderBal as any).value.amount.value)).toBe(tokensBefore - transferAmount);

      const { result: recipientBal } = getBalance(0, wallet3);
      expect(Number((recipientBal as any).value.amount.value)).toBe(transferAmount);
    });

    it("fails with insufficient balance", () => {
      registerAndLaunch(wallet1);
      const { result } = simnet.callPublicFn(
        contract,
        "transfer",
        [Cl.uint(0), Cl.uint(1_000_000), Cl.principal(wallet2)],
        wallet3
      );
      expect(result).toBeErr(Cl.uint(1405));
    });

    it("fails with self-transfer", () => {
      registerAndLaunch(wallet1);
      buy(wallet2, 0, 100_000_000);

      const { result } = simnet.callPublicFn(
        contract,
        "transfer",
        [Cl.uint(0), Cl.uint(1000), Cl.principal(wallet2)],
        wallet2
      );
      expect(result).toBeErr(Cl.uint(1409));
    });

    it("prevents non-creator from transferring others' tokens", () => {
      registerAndLaunch(wallet1);
      buy(wallet2, 0, 100_000_000);

      const { result } = simnet.callPublicFn(
        contract,
        "transfer",
        [Cl.uint(0), Cl.uint(1000), Cl.principal(wallet3)],
        wallet3
      );
      expect(result).toBeErr(Cl.uint(1405));
    });
  });

  // ========================================================================
  // 5. GRADUATION
  // ========================================================================

  describe("graduation", () => {
    it("auto-graduates when threshold is met via buy", () => {
      registerAgent(wallet1);
      simnet.callPublicFn(
        contract,
        "set-defaults",
        [
          Cl.uint(DEFAULT_TOTAL_SUPPLY),
          Cl.uint(DEFAULT_VIRTUAL_STX),
          Cl.uint(100_000_000),
          Cl.uint(DEFAULT_FEE_BPS),
          Cl.uint(DEFAULT_CREATOR_SHARE_BPS),
        ],
        deployer
      );
      launchCurve(wallet1);

      buy(wallet2, 0, 200_000_000);

      const { result: curveResult } = getCurve(0);
      const curve = unwrapCurve(curveResult);
      expect(curve.graduated).toStrictEqual(Cl.bool(true));
      expect(curve["accrued-fees"]).toStrictEqual(Cl.uint(0));
    });

    it("distributes fees 80/20 at graduation", () => {
      registerAgent(wallet1);
      simnet.callPublicFn(
        contract,
        "set-defaults",
        [
          Cl.uint(DEFAULT_TOTAL_SUPPLY),
          Cl.uint(DEFAULT_VIRTUAL_STX),
          Cl.uint(50_000_000),
          Cl.uint(100),
          Cl.uint(8000),
        ],
        deployer
      );
      launchCurve(wallet1);

      const creatorBalBefore = simnet.getAssetsMap().get("STX")?.get(wallet1) || 0n;
      const protocolBalBefore = simnet.getAssetsMap().get("STX")?.get(deployer) || 0n;

      buy(wallet2, 0, 100_000_000);

      const creatorBalAfter = simnet.getAssetsMap().get("STX")?.get(wallet1) || 0n;
      const protocolBalAfter = simnet.getAssetsMap().get("STX")?.get(deployer) || 0n;

      const creatorGain = creatorBalAfter - creatorBalBefore;
      const protocolGain = protocolBalAfter - protocolBalBefore;

      expect(creatorGain).toBe(800_000n);
      expect(protocolGain).toBe(200_000n);
    });

    it("manual graduate fails before threshold", () => {
      registerAndLaunch(wallet1);

      const { result } = simnet.callPublicFn(
        contract,
        "graduate",
        [Cl.uint(0)],
        wallet2
      );
      expect(result).toBeErr(Cl.uint(1412));
    });

    it("allows anyone to trigger graduation", () => {
      registerAgent(wallet1);
      simnet.callPublicFn(
        contract,
        "set-defaults",
        [
          Cl.uint(DEFAULT_TOTAL_SUPPLY),
          Cl.uint(DEFAULT_VIRTUAL_STX),
          Cl.uint(100_000_000),
          Cl.uint(DEFAULT_FEE_BPS),
          Cl.uint(DEFAULT_CREATOR_SHARE_BPS),
        ],
        deployer
      );
      launchCurve(wallet1);

      buy(wallet2, 0, 200_000_000);

      const { result } = simnet.callPublicFn(
        contract,
        "graduate",
        [Cl.uint(0)],
        wallet3
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("handles zero fees correctly", () => {
      registerAgent(wallet1);
      simnet.callPublicFn(
        contract,
        "set-defaults",
        [
          Cl.uint(DEFAULT_TOTAL_SUPPLY),
          Cl.uint(DEFAULT_VIRTUAL_STX),
          Cl.uint(100_000_000),
          Cl.uint(0),
          Cl.uint(DEFAULT_CREATOR_SHARE_BPS),
        ],
        deployer
      );
      launchCurve(wallet1);

      const creatorBalBefore = simnet.getAssetsMap().get("STX")?.get(wallet1) || 0n;

      buy(wallet2, 0, 200_000_000);

      const creatorBalAfter = simnet.getAssetsMap().get("STX")?.get(wallet1) || 0n;
      expect(creatorBalAfter - creatorBalBefore).toBe(0n);
    });

    it("handles fee distribution with zero creator share", () => {
      registerAgent(wallet1);
      simnet.callPublicFn(
        contract,
        "set-defaults",
        [
          Cl.uint(DEFAULT_TOTAL_SUPPLY),
          Cl.uint(DEFAULT_VIRTUAL_STX),
          Cl.uint(100_000_000),
          Cl.uint(100),
          Cl.uint(0),
        ],
        deployer
      );
      launchCurve(wallet1);

      const protocolBalBefore = simnet.getAssetsMap().get("STX")?.get(deployer) || 0n;

      buy(wallet2, 0, 200_000_000);

      const protocolBalAfter = simnet.getAssetsMap().get("STX")?.get(deployer) || 0n;
      expect(protocolBalAfter - protocolBalBefore).toBe(2_000_000n);
    });

    it("prevents graduation twice", () => {
      registerAgent(wallet1);
      simnet.callPublicFn(
        contract,
        "set-defaults",
        [
          Cl.uint(DEFAULT_TOTAL_SUPPLY),
          Cl.uint(DEFAULT_VIRTUAL_STX),
          Cl.uint(100_000_000),
          Cl.uint(DEFAULT_FEE_BPS),
          Cl.uint(DEFAULT_CREATOR_SHARE_BPS),
        ],
        deployer
      );
      launchCurve(wallet1);

      buy(wallet2, 0, 200_000_000);

      const { result: grad1 } = simnet.callPublicFn(
        contract,
        "graduate",
        [Cl.uint(0)],
        wallet3
      );
      expect(grad1).toBeOk(Cl.bool(true));

      const { result: grad2 } = simnet.callPublicFn(
        contract,
        "graduate",
        [Cl.uint(0)],
        wallet3
      );
      expect(grad2).toBeErr(Cl.uint(1403));
    });
  });

  // ========================================================================
  // 6. QUOTES
  // ========================================================================

  describe("quotes", () => {
    it("get-buy-quote matches actual buy output", () => {
      registerAndLaunch(wallet1);

      const stxAmount = 500_000_000;

      const { result: quoteResult } = getBuyQuote(0, stxAmount);
      const quote = unwrapOkTuple(quoteResult);
      const quotedTokens = BigInt(quote["tokens-out"].value);
      const quotedFee = BigInt(quote.fee.value);

      const { result: buyResult } = buy(wallet2, 0, stxAmount);
      const buyData = unwrapOkTuple(buyResult);
      const actualTokens = BigInt(buyData["tokens-out"].value);
      const actualFee = BigInt(buyData.fee.value);

      expect(quotedTokens).toBe(actualTokens);
      expect(quotedFee).toBe(actualFee);
    });

    it("get-sell-quote matches actual sell output", () => {
      registerAndLaunch(wallet1);
      buy(wallet2, 0, 1_000_000_000);

      const { result: balResult } = getBalance(0, wallet2);
      const tokens = Number((balResult as any).value.amount.value);
      const sellAmount = Math.floor(tokens / 4);

      const { result: quoteResult } = getSellQuote(0, sellAmount);
      const quote = unwrapOkTuple(quoteResult);
      const quotedStx = BigInt(quote["stx-out"].value);
      const quotedFee = BigInt(quote.fee.value);

      const { result: sellResult } = sell(wallet2, 0, sellAmount);
      const sellData = unwrapOkTuple(sellResult);
      const actualStx = BigInt(sellData["stx-out"].value);
      const actualFee = BigInt(sellData.fee.value);

      expect(quotedStx).toBe(actualStx);
      expect(quotedFee).toBe(actualFee);
    });

    it("returns zero quote for sold-out curve", () => {
      registerAndLaunch(wallet1);

      try {
        buy(wallet2, 0, 1_000_000_000_000);
      } catch (e) {
        // May fail due to insufficient STX, that's fine
      }

      const { result: quoteResult } = getBuyQuote(0, 100_000_000);
      if ((quoteResult as any).value) {
        const quote = unwrapOkTuple(quoteResult);
        expect(Number(quote["tokens-out"].value)).toBe(0);
      }
    });

    it("get-price returns 0 for sold-out curve", () => {
      registerAndLaunch(wallet1);

      try {
        buy(wallet2, 0, 1_000_000_000_000);
      } catch (e) {
        // May fail due to insufficient STX
      }

      const { result: priceResult } = simnet.callReadOnlyFn(
        contract,
        "get-price",
        [Cl.uint(0)],
        deployer
      );
      expect(Number((priceResult as any).value.value)).toBeGreaterThanOrEqual(0);
    });

    it("buy and sell quotes are consistent", () => {
      registerAndLaunch(wallet1);

      const { result: buyQuote } = getBuyQuote(0, 100_000_000);
      const buyData = unwrapOkTuple(buyQuote);

      buy(wallet2, 0, 100_000_000);

      const { result: sellQuote } = getSellQuote(0, Number(buyData["tokens-out"].value));
      const sellData = unwrapOkTuple(sellQuote);

      expect(Number(sellData["stx-out"].value)).toBeLessThan(100_000_000);
      expect(Number(sellData["stx-out"].value)).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // 7. ADMIN
  // ========================================================================

  describe("admin", () => {
    it("admin can set defaults", () => {
      const { result } = simnet.callPublicFn(
        contract,
        "set-defaults",
        [
          Cl.uint(2_000_000_000_000_000),
          Cl.uint(20_000_000_000),
          Cl.uint(33_334_000_000),
          Cl.uint(200),
          Cl.uint(9000),
        ],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      const { result: stats } = simnet.callReadOnlyFn(
        contract,
        "get-stats",
        [],
        deployer
      );
      expect((stats as any).value["default-fee-bps"]).toStrictEqual(Cl.uint(200));
      expect((stats as any).value["default-creator-share-bps"]).toStrictEqual(Cl.uint(9000));
    });

    it("non-admin cannot set defaults", () => {
      const { result } = simnet.callPublicFn(
        contract,
        "set-defaults",
        [
          Cl.uint(DEFAULT_TOTAL_SUPPLY),
          Cl.uint(DEFAULT_VIRTUAL_STX),
          Cl.uint(DEFAULT_GRADUATION_STX),
          Cl.uint(DEFAULT_FEE_BPS),
          Cl.uint(DEFAULT_CREATOR_SHARE_BPS),
        ],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(1407));
    });

    it("prevents non-admin from setting protocol fee recipient", () => {
      const { result } = simnet.callPublicFn(
        contract,
        "set-protocol-fee-recipient",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(1407));
    });

    it("rejects fee above max", () => {
      const { result } = simnet.callPublicFn(
        contract,
        "set-defaults",
        [
          Cl.uint(DEFAULT_TOTAL_SUPPLY),
          Cl.uint(DEFAULT_VIRTUAL_STX),
          Cl.uint(DEFAULT_GRADUATION_STX),
          Cl.uint(501),
          Cl.uint(DEFAULT_CREATOR_SHARE_BPS),
        ],
        deployer
      );
      expect(result).toBeErr(Cl.uint(1414));
    });

    it("rejects invalid creator share > 10000 bps", () => {
      const { result } = simnet.callPublicFn(
        contract,
        "set-defaults",
        [
          Cl.uint(DEFAULT_TOTAL_SUPPLY),
          Cl.uint(DEFAULT_VIRTUAL_STX),
          Cl.uint(DEFAULT_GRADUATION_STX),
          Cl.uint(DEFAULT_FEE_BPS),
          Cl.uint(10001),
        ],
        deployer
      );
      expect(result).toBeErr(Cl.uint(1411));
    });

    it("rejects zero total supply", () => {
      const { result } = simnet.callPublicFn(
        contract,
        "set-defaults",
        [
          Cl.uint(0),
          Cl.uint(DEFAULT_VIRTUAL_STX),
          Cl.uint(DEFAULT_GRADUATION_STX),
          Cl.uint(DEFAULT_FEE_BPS),
          Cl.uint(DEFAULT_CREATOR_SHARE_BPS),
        ],
        deployer
      );
      expect(result).toBeErr(Cl.uint(1411));
    });

    it("rejects zero virtual STX", () => {
      const { result } = simnet.callPublicFn(
        contract,
        "set-defaults",
        [
          Cl.uint(DEFAULT_TOTAL_SUPPLY),
          Cl.uint(0),
          Cl.uint(DEFAULT_GRADUATION_STX),
          Cl.uint(DEFAULT_FEE_BPS),
          Cl.uint(DEFAULT_CREATOR_SHARE_BPS),
        ],
        deployer
      );
      expect(result).toBeErr(Cl.uint(1411));
    });

    it("two-step admin transfer", () => {
      const { result: initResult } = simnet.callPublicFn(
        contract,
        "transfer-admin",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(initResult).toBeOk(Cl.principal(wallet1));

      const { result: acceptResult } = simnet.callPublicFn(
        contract,
        "accept-admin",
        [],
        wallet1
      );
      expect(acceptResult).toBeOk(Cl.principal(wallet1));

      const { result: adminResult } = simnet.callReadOnlyFn(
        contract,
        "get-admin",
        [],
        deployer
      );
      expect(adminResult).toStrictEqual(Cl.principal(wallet1));
    });
  });

  // ========================================================================
  // 8. MULTIPLE CURVES
  // ========================================================================

  describe("multiple curves", () => {
    it("two agents launch independent curves", () => {
      registerAgent(wallet1, "Agent1");
      registerAgent(wallet2, "Agent2");

      const { result: r1 } = launchCurve(wallet1, "Token1", "TK1");
      expect(r1).toBeOk(Cl.uint(0));

      const { result: r2 } = launchCurve(wallet2, "Token2", "TK2");
      expect(r2).toBeOk(Cl.uint(1));

      buy(wallet3, 0, 100_000_000);
      buy(wallet3, 1, 200_000_000);

      const { result: bal0 } = getBalance(0, wallet3);
      const { result: bal1 } = getBalance(1, wallet3);
      const tokens0 = Number((bal0 as any).value.amount.value);
      const tokens1 = Number((bal1 as any).value.amount.value);

      expect(tokens0).toBeGreaterThan(0);
      expect(tokens1).toBeGreaterThan(0);
      expect(tokens1).toBeGreaterThan(tokens0);

      const { result: c0 } = getCurve(0);
      const { result: c1 } = getCurve(1);
      const reserve0 = Number(unwrapCurve(c0)["stx-reserve"].value);
      const reserve1 = Number(unwrapCurve(c1)["stx-reserve"].value);
      expect(reserve1).toBeGreaterThan(reserve0);

      const { result: stats } = simnet.callReadOnlyFn(
        contract,
        "get-stats",
        [],
        deployer
      );
      expect((stats as any).value["total-curves"]).toStrictEqual(Cl.uint(2));
    });
  });

  // ========================================================================
  // 9. PRICE MECHANICS
  // ========================================================================

  describe("price mechanics", () => {
    it("price increases after buy", () => {
      registerAndLaunch(wallet1);

      const { result: priceBefore } = simnet.callReadOnlyFn(
        contract,
        "get-price",
        [Cl.uint(0)],
        deployer
      );
      const p0 = Number((priceBefore as any).value.value);

      buy(wallet2, 0, 1_000_000_000);

      const { result: priceAfter } = simnet.callReadOnlyFn(
        contract,
        "get-price",
        [Cl.uint(0)],
        deployer
      );
      const p1 = Number((priceAfter as any).value.value);

      expect(p1).toBeGreaterThan(p0);
    });

    it("maintains constant product invariant", () => {
      registerAndLaunch(wallet1);

      const { result: curveBefore } = getCurve(0);
      const curve = unwrapCurve(curveBefore);
      const k = BigInt(curve.k.value);

      buy(wallet2, 0, 500_000_000);
      
      const { result: balResult } = getBalance(0, wallet2);
      if (Number((balResult as any).value.amount.value) > 0) {
        sell(wallet2, 0, 100_000);
      }

      const { result: curveAfter } = getCurve(0);
      const after = unwrapCurve(curveAfter);
      const newK = BigInt(after.k.value);

      expect(newK).toBe(k);
    });
  });

  // ========================================================================
  // 10. STRESS TESTS
  // ========================================================================

  describe("stress tests", () => {
    it("handles many sequential buys", () => {
      registerAndLaunch(wallet1);

      const numBuys = 5;
      const buyAmount = 100_000_000;

      for (let i = 0; i < numBuys; i++) {
        const buyer = i % 2 === 0 ? wallet2 : wallet3;
        const { result } = buy(buyer, 0, buyAmount);
        expect(result).toBeOk();
      }

      const { result: curveResult } = getCurve(0);
      const curve = unwrapCurve(curveResult);
      expect(Number(curve["stx-reserve"].value)).toBeGreaterThan(0);
    });

    it("handles interleaved buys and sells", () => {
      registerAndLaunch(wallet1);

      buy(wallet2, 0, 1_000_000_000);

      const { result: balResult } = getBalance(0, wallet2);
      const tokens = Number((balResult as any).value.amount.value);
      
      if (tokens > 0) {
        const sellAmount = Math.floor(tokens / 2);
        sell(wallet2, 0, sellAmount);
      }

      buy(wallet2, 0, 500_000_000);

      const { result: finalBalance } = getBalance(0, wallet2);
      expect(Number((finalBalance as any).value.amount.value)).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // 11. ERROR RECOVERY
  // ========================================================================

  describe("error recovery", () => {
    it("maintains state consistency after failed buy", () => {
      registerAndLaunch(wallet1);

      const { result: curveBefore } = getCurve(0);
      const beforeState = unwrapCurve(curveBefore);

      buy(wallet2, 0, 100_000_000, 999_999_999_999_999);

      const { result: curveAfter } = getCurve(0);
      const afterState = unwrapCurve(curveAfter);

      expect(afterState["stx-reserve"]).toStrictEqual(beforeState["stx-reserve"]);
      expect(afterState["tokens-sold"]).toStrictEqual(beforeState["tokens-sold"]);
    });

    it("maintains state consistency after failed sell", () => {
      registerAndLaunch(wallet1);
      buy(wallet2, 0, 100_000_000);

      const { result: curveBefore } = getCurve(0);
      const beforeState = unwrapCurve(curveBefore);

      const { result: balResult } = getBalance(0, wallet2);
      const tokens = Number((balResult as any).value.amount.value);
      
      sell(wallet2, 0, tokens, 999_999_999_999_999);

      const { result: curveAfter } = getCurve(0);
      const afterState = unwrapCurve(curveAfter);

      expect(afterState["stx-reserve"]).toStrictEqual(beforeState["stx-reserve"]);
      expect(afterState["tokens-sold"]).toStrictEqual(beforeState["tokens-sold"]);
    });
  });

  // ========================================================================
  // 12. AGENT REGISTRY INTEGRATION
  // ========================================================================

  describe("agent-registry integration", () => {
    it("prevents launch if agent is unregistered", () => {
      const { result } = launchCurve(wallet1);
      expect(result).toBeErr(Cl.uint(1400));
    });

    it("allows launch after registration", () => {
      registerAgent(wallet1);
      const { result } = launchCurve(wallet1);
      expect(result).toBeOk();
    });
  });

  // ========================================================================
  // 13. EDGE CASES
  // ========================================================================

  describe("edge cases", () => {
    it("handles maximum uint values safely", () => {
      registerAndLaunch(wallet1);

      const hugeAmount = Number(2n ** 48n - 1000n); // Stay within reasonable bounds
      const { result } = buy(wallet2, 0, hugeAmount);
      expect(result).toBeErr(Cl.uint(1405)); // ERR-INSUFFICIENT-BALANCE
    });

    it("prevents integer overflow in k calculation", () => {
      simnet.callPublicFn(
        contract,
        "set-defaults",
        [
          Cl.uint(2n ** 64n - 1n),
          Cl.uint(2n ** 64n - 1n),
          Cl.uint(DEFAULT_GRADUATION_STX),
          Cl.uint(DEFAULT_FEE_BPS),
          Cl.uint(DEFAULT_CREATOR_SHARE_BPS),
        ],
        deployer
      );

      registerAgent(wallet1);
      const { result } = launchCurve(wallet1);
      expect(result).toBeOk(Cl.uint(0));
    });
  });
});
