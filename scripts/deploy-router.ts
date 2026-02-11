/**
 * Deploy x402-curve-router to Stacks testnet.
 *
 * Run: npx tsx scripts/deploy-router.ts
 */

import {
  makeContractDeploy,
  broadcastTransaction,
  AnchorMode,
  PostConditionMode,
} from "@stacks/transactions";
import { generateWallet } from "@stacks/wallet-sdk";
import { STACKS_TESTNET } from "@stacks/network";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEPLOYER = "ST356P5YEXBJC1ZANBWBNR0N0X7NT8AV7FZ017K55";
const MNEMONIC =
  "bronze infant program remain silent chair reason erase second cycle save attack flock wagon sea same into urge own trouble mountain squirrel small skull";
const API = "https://api.testnet.hiro.so";

async function main() {
  console.log("Deploying x402-curve-router to testnet...\n");

  // Derive key
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const privateKey = wallet.accounts[0].stxPrivateKey;

  // Get nonce
  const nonceResp = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`);
  const nonceData = (await nonceResp.json()) as { nonce: number };
  const nonce = BigInt(nonceData.nonce);
  console.log(`  Nonce: ${nonce}`);

  // Read contract source
  const contractPath = resolve(__dirname, "../contracts/x402-curve-router.clar");
  const codeBody = readFileSync(contractPath, "utf-8");
  console.log(`  Contract: ${codeBody.length} chars`);

  // Deploy
  const tx = await makeContractDeploy({
    contractName: "x402-curve-router",
    codeBody,
    senderKey: privateKey,
    nonce,
    fee: 100000n,
    network: STACKS_TESTNET,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
    clarityVersion: 4,
  });

  const result = await broadcastTransaction({
    transaction: tx,
    network: STACKS_TESTNET,
  });

  if ("error" in result) {
    throw new Error(`Broadcast failed: ${JSON.stringify(result)}`);
  }

  const txid = typeof result === "string" ? result : result.txid;
  console.log(`\n→ Deploy tx: ${txid}`);
  console.log(`  Explorer: https://explorer.hiro.so/txid/${txid}?chain=testnet`);

  // Wait for confirmation
  console.log("\n  Waiting for confirmation...");
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    try {
      const resp = await fetch(`${API}/extended/v1/tx/${txid}`);
      const data = (await resp.json()) as { tx_status: string };
      if (data.tx_status === "success") {
        console.log(`  ✓ Deployed! ${DEPLOYER}.x402-curve-router`);
        return;
      }
      if (
        data.tx_status === "abort_by_response" ||
        data.tx_status === "abort_by_post_condition"
      ) {
        throw new Error(`Deploy failed: ${data.tx_status}`);
      }
      process.stdout.write(".");
    } catch (e: unknown) {
      if (e instanceof Error && e.message.startsWith("Deploy failed")) throw e;
    }
  }
  throw new Error("Timeout waiting for deploy tx");
}

main().catch((err) => {
  console.error("\n✗ Error:", err);
  process.exit(1);
});
