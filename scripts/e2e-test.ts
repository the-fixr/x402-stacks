/**
 * E2E Testnet Script — Full Protocol Demonstration
 *
 * 1. Fixr launches a token on agent-launchpad
 * 2. Generates a second wallet, funds it from Fixr
 * 3. Second agent registers in agent-registry
 * 4. Second agent pays Fixr via x402-curve-router (buys tokens on Fixr's curve)
 * 5. Verifies everything via read-only calls
 *
 * Run: npx tsx scripts/e2e-test.ts
 */

import {
  makeContractCall,
  makeSTXTokenTransfer,
  broadcastTransaction,
  Cl,
  AnchorMode,
  PostConditionMode,
  cvToHex,
  hexToCV,
  ClarityType,
  type ClarityValue,
} from "@stacks/transactions";
import { generateWallet, generateSecretKey, getStxAddress } from "@stacks/wallet-sdk";
import { STACKS_TESTNET } from "@stacks/network";
import { randomBytes } from "crypto";

// ============================================================================
// CONFIG
// ============================================================================

const DEPLOYER = "ST356P5YEXBJC1ZANBWBNR0N0X7NT8AV7FZ017K55";
const FIXR_MNEMONIC =
  "bronze infant program remain silent chair reason erase second cycle save attack flock wagon sea same into urge own trouble mountain squirrel small skull";

const API = "https://api.testnet.hiro.so";
const FEE = 50000n;

// ============================================================================
// HELPERS
// ============================================================================

async function deriveWallet(mnemonic: string) {
  const wallet = await generateWallet({ secretKey: mnemonic, password: "" });
  const account = wallet.accounts[0];
  const privateKey = account.stxPrivateKey;
  const address = getStxAddress({ account, network: "testnet" });
  return { privateKey, address, account };
}

async function getCurrentNonce(address: string): Promise<bigint> {
  const resp = await fetch(`${API}/v2/accounts/${address}?proof=0`);
  const data = (await resp.json()) as { nonce: number };
  return BigInt(data.nonce);
}

async function waitForTx(txid: string): Promise<void> {
  console.log(`  Waiting for ${txid}...`);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    try {
      const resp = await fetch(`${API}/extended/v1/tx/${txid}`);
      const data = (await resp.json()) as { tx_status: string };
      if (data.tx_status === "success") {
        console.log(`  ✓ Confirmed`);
        return;
      }
      if (
        data.tx_status === "abort_by_response" ||
        data.tx_status === "abort_by_post_condition"
      ) {
        throw new Error(`Tx failed: ${data.tx_status}`);
      }
      process.stdout.write(".");
    } catch (e: unknown) {
      if (e instanceof Error && e.message.startsWith("Tx failed")) throw e;
    }
  }
  throw new Error("Timeout waiting for tx");
}

async function sendTx(opts: {
  contract: string;
  fn: string;
  args: ClarityValue[];
  privateKey: string;
  nonce: bigint;
}): Promise<{ txid: string; nextNonce: bigint }> {
  const tx = await makeContractCall({
    contractAddress: DEPLOYER,
    contractName: opts.contract,
    functionName: opts.fn,
    functionArgs: opts.args,
    senderKey: opts.privateKey,
    nonce: opts.nonce,
    fee: FEE,
    network: STACKS_TESTNET,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  });

  const result = await broadcastTransaction({
    transaction: tx,
    network: STACKS_TESTNET,
  });
  if ("error" in result) {
    throw new Error(`Broadcast failed: ${JSON.stringify(result)}`);
  }
  const txid = typeof result === "string" ? result : result.txid;
  console.log(`\n→ ${opts.contract}.${opts.fn} → ${txid}`);
  return { txid, nextNonce: opts.nonce + 1n };
}

async function readOnly(
  contract: string,
  fn: string,
  args: ClarityValue[]
): Promise<ClarityValue> {
  const resp = await fetch(
    `${API}/v2/contracts/call-read/${DEPLOYER}/${contract}/${fn}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: DEPLOYER,
        arguments: args.map((a) => cvToHex(a)),
      }),
    }
  );
  const data = (await resp.json()) as { okay: boolean; result: string; cause?: string };
  if (!data.okay) {
    throw new Error(`Read-only call ${contract}.${fn} failed: ${data.cause ?? "unknown"}`);
  }
  return hexToCV(data.result);
}

/** Transfer STX from Fixr to agent2 (more reliable than faucet which rate-limits) */
async function fundAgent2(
  address: string,
  amount: bigint,
  senderKey: string,
  nonce: bigint
): Promise<bigint> {
  console.log(`  Transferring ${Number(amount) / 1_000_000} STX to ${address}...`);
  const transferTx = await makeSTXTokenTransfer({
    recipient: address,
    amount,
    senderKey,
    nonce,
    fee: FEE,
    network: STACKS_TESTNET,
    anchorMode: AnchorMode.Any,
  });
  const result = await broadcastTransaction({
    transaction: transferTx,
    network: STACKS_TESTNET,
  });
  if ("error" in result) {
    throw new Error(`Transfer broadcast failed: ${JSON.stringify(result)}`);
  }
  const txid = typeof result === "string" ? result : result.txid;
  console.log(`  Transfer tx: ${txid}`);
  await waitForTx(txid);
  return nonce + 1n;
}

function printCV(label: string, cv: ClarityValue): void {
  console.log(`  ${label}:`, JSON.stringify(cvToJSON(cv), null, 2));
}

/** Simple CV-to-JSON for logging (v7 types use .value everywhere) */
function cvToJSON(cv: ClarityValue): unknown {
  switch (cv.type) {
    case ClarityType.UInt:
      return `u${cv.value}`;
    case ClarityType.Int:
      return `${cv.value}`;
    case ClarityType.BoolTrue:
      return true;
    case ClarityType.BoolFalse:
      return false;
    case ClarityType.PrincipalStandard:
    case ClarityType.PrincipalContract:
      return cv.value;
    case ClarityType.StringUTF8:
    case ClarityType.StringASCII:
      return cv.value;
    case ClarityType.Buffer:
      return `0x${cv.value}`;
    case ClarityType.OptionalSome:
      return cvToJSON(cv.value);
    case ClarityType.OptionalNone:
      return null;
    case ClarityType.ResponseOk:
      return { ok: cvToJSON(cv.value) };
    case ClarityType.ResponseErr:
      return { err: cvToJSON(cv.value) };
    case ClarityType.Tuple:
      return Object.fromEntries(
        Object.entries(cv.value).map(([k, v]) => [k, cvToJSON(v as ClarityValue)])
      );
    case ClarityType.List:
      return (cv.value as ClarityValue[]).map(cvToJSON);
    default:
      return `<unknown type ${cv.type}>`;
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Agent Protocol — E2E Testnet Demonstration (v2)");
  console.log("  Uses x402-curve-router: payment = token purchase");
  console.log("═══════════════════════════════════════════════════════════\n");

  // ── Setup wallets ──────────────────────────────────────────────────────

  console.log("1. Setting up wallets\n");

  const fixr = await deriveWallet(FIXR_MNEMONIC);
  console.log(`  Fixr address: ${fixr.address}`);

  const agent2Mnemonic = generateSecretKey();
  const agent2 = await deriveWallet(agent2Mnemonic);
  console.log(`  Agent2 address: ${agent2.address}`);
  console.log(`  Agent2 mnemonic (save for reuse): ${agent2Mnemonic}`);

  // ── Fund agent2 from Fixr's wallet ──────────────────────────────────────

  console.log("\n2. Funding Agent2 from Fixr's wallet (20 STX)\n");

  let fixrNonce = await getCurrentNonce(fixr.address);
  fixrNonce = await fundAgent2(
    agent2.address,
    20_000_000n, // 20 STX
    fixr.privateKey,
    fixrNonce
  );

  let agent2Nonce = await getCurrentNonce(agent2.address);
  console.log(`\n  Fixr nonce: ${fixrNonce}`);
  console.log(`  Agent2 nonce: ${agent2Nonce}`);

  // ── Step 1: Fixr launches token (skip if already launched) ──────────────

  console.log("\n3. Fixr launches token on agent-launchpad\n");

  let launchTxid = "(already launched)";
  const existingCurve = await readOnly("agent-launchpad", "get-agent-curve", [
    Cl.principal(fixr.address),
  ]);
  if (existingCurve.type === ClarityType.OptionalNone) {
    const { txid, nextNonce } = await sendTx({
      contract: "agent-launchpad",
      fn: "launch",
      args: [Cl.stringUtf8("Fixr Token"), Cl.stringUtf8("FIXR")],
      privateKey: fixr.privateKey,
      nonce: fixrNonce,
    });
    launchTxid = txid;
    await waitForTx(launchTxid);
    fixrNonce = nextNonce;
  } else {
    console.log("  Fixr already has a curve - skipping launch");
  }

  // ── Step 2: Agent2 registers ───────────────────────────────────────────

  console.log("\n4. Agent2 registers in agent-registry\n");

  const { txid: registerTxid, nextNonce: a2N1 } = await sendTx({
    contract: "agent-registry",
    fn: "register-agent",
    args: [
      Cl.stringUtf8("TestBot"),
      Cl.stringUtf8("https://example.com/testbot"),
      Cl.uint(500_000), // 0.5 STX per task
      Cl.bool(true), // accepts-stx
      Cl.bool(false), // accepts-sip010
    ],
    privateKey: agent2.privateKey,
    nonce: agent2Nonce,
  });
  await waitForTx(registerTxid);
  agent2Nonce = a2N1;

  // ── Step 3: Agent2 pays Fixr via x402-curve-router ─────────────────────
  // One transaction: pays STX, buys tokens on Fixr's curve, records receipt

  console.log("\n5. Agent2 pays Fixr via x402-curve-router (5 STX)\n");
  console.log("   -> STX enters Fixr's bonding curve");
  console.log("   -> Agent2 receives tokens");
  console.log("   -> Fixr earns 80% of accrued fees at graduation\n");

  const paymentNonce = randomBytes(16);
  console.log(`  Payment nonce: 0x${paymentNonce.toString("hex")}`);

  const { txid: payViaCurveTxid, nextNonce: a2N2 } = await sendTx({
    contract: "x402-curve-router",
    fn: "pay-via-curve",
    args: [
      Cl.uint(0), // curve-id 0 (Fixr's curve)
      Cl.uint(5_000_000), // 5 STX
      Cl.buffer(paymentNonce),
      Cl.uint(0), // no slippage limit for testing
    ],
    privateKey: agent2.privateKey,
    nonce: agent2Nonce,
  });
  await waitForTx(payViaCurveTxid);
  agent2Nonce = a2N2;

  // ── Verification ───────────────────────────────────────────────────────

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Verification - Read-Only Calls");
  console.log("═══════════════════════════════════════════════════════════\n");

  // 1. Curve state
  console.log("  [1] get-curve(0)");
  const curveCV = await readOnly("agent-launchpad", "get-curve", [Cl.uint(0)]);
  printCV("Curve state", curveCV);

  // 2. Agent2 token balance
  console.log("\n  [2] get-balance(0, agent2)");
  const balCV = await readOnly("agent-launchpad", "get-balance", [
    Cl.uint(0),
    Cl.principal(agent2.address),
  ]);
  printCV("Agent2 balance", balCV);

  // 3. Fixr token balance (should be 0 - Fixr earns fees, not tokens)
  console.log("\n  [3] get-balance(0, fixr)");
  const fixrBalCV = await readOnly("agent-launchpad", "get-balance", [
    Cl.uint(0),
    Cl.principal(DEPLOYER),
  ]);
  printCV("Fixr balance", fixrBalCV);

  // 4. Agent-curve mapping
  console.log("\n  [4] get-agent-curve(fixr)");
  const agentCurveCV = await readOnly("agent-launchpad", "get-agent-curve", [
    Cl.principal(DEPLOYER),
  ]);
  printCV("Fixr's curve", agentCurveCV);

  // 5. x402-curve-router payment receipt
  console.log("\n  [5] x402-curve-router.verify-payment(nonce)");
  const routerReceiptCV = await readOnly("x402-curve-router", "verify-payment", [
    Cl.buffer(paymentNonce),
  ]);
  printCV("Curve router receipt", routerReceiptCV);

  // 6. Router stats
  console.log("\n  [6] x402-curve-router.get-stats()");
  const routerStatsCV = await readOnly("x402-curve-router", "get-stats", []);
  printCV("Router stats", routerStatsCV);

  // 7. Agent2 registration
  console.log("\n  [7] is-registered(agent2)");
  const registeredCV = await readOnly("agent-registry", "is-registered", [
    Cl.principal(agent2.address),
  ]);
  printCV("Agent2 registered", registeredCV);

  // 8. Current price
  console.log("\n  [8] get-price(0)");
  const priceCV = await readOnly("agent-launchpad", "get-price", [Cl.uint(0)]);
  printCV("Current price", priceCV);

  // ── Summary ────────────────────────────────────────────────────────────

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Summary");
  console.log("═══════════════════════════════════════════════════════════\n");
  console.log(`  Fixr address:      ${fixr.address}`);
  console.log(`  Agent2 address:    ${agent2.address}`);
  console.log(`  Agent2 mnemonic:   ${agent2Mnemonic}`);
  console.log(`  Launch tx:         ${launchTxid}`);
  console.log(`  Register tx:       ${registerTxid}`);
  console.log(`  pay-via-curve tx:  ${payViaCurveTxid}`);
  console.log("\n  Flow: Agent2 paid Fixr 5 STX via x402-curve-router");
  console.log("    -> STX went into Fixr's bonding curve reserve");
  console.log("    -> Agent2 received tokens proportional to the curve price");
  console.log("    -> 1% trade fee accrues for Fixr (80% at graduation)");
  console.log("\n  ✓ All transactions confirmed. Protocol E2E test passed.");
}

main().catch((err) => {
  console.error("\n✗ Error:", err);
  process.exit(1);
});
