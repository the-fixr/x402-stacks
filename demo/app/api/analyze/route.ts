import { NextRequest, NextResponse } from "next/server";

const CONTRACT_ADDRESS = "ST356P5YEXBJC1ZANBWBNR0N0X7NT8AV7FZ017K55";
const CONTRACT_NAME = "x402-payments";
// Use a separate treasury address to avoid self-payment rejection
// (deployer wallet can't pay itself through the contract)
const PAY_TO = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";
const PRICE_MICRO_STX = "10000"; // 0.01 STX
const API_URL = "https://api.testnet.hiro.so";

/**
 * GET /api/analyze?token=STX
 *
 * Returns token analysis data. Gated behind x402 payment.
 * Without PAYMENT-SIGNATURE header: returns 402 with payment requirements.
 * With valid payment proof: returns the analysis.
 */
export async function GET(request: NextRequest) {
  const paymentHeader = request.headers.get("PAYMENT-SIGNATURE");

  // No payment — return 402 Payment Required
  if (!paymentHeader) {
    const resource = {
      url: request.url,
      description: "Stacks token analysis with holder data, transfer history, and metrics",
      mimeType: "application/json",
    };

    const paymentRequired = {
      x402Version: 2,
      error: "Payment required",
      resource,
      accepts: [
        {
          scheme: "exact",
          network: "stacks:2147483648",
          asset: "STX",
          amount: PRICE_MICRO_STX,
          payTo: PAY_TO,
          maxTimeoutSeconds: 300,
          extra: {
            contractAddress: CONTRACT_ADDRESS,
            contractName: CONTRACT_NAME,
          },
        },
      ],
    };

    const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString("base64");

    return NextResponse.json(
      {
        error: "payment_required",
        message: "Pay 0.01 STX to access token analysis",
        price: "0.01 STX",
        contract: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
      },
      {
        status: 402,
        headers: {
          "PAYMENT-REQUIRED": encoded,
        },
      }
    );
  }

  // Has payment header — verify it
  let payload;
  try {
    const decoded = Buffer.from(paymentHeader, "base64").toString("utf-8");
    payload = JSON.parse(decoded);
  } catch {
    return NextResponse.json({ error: "Invalid payment header" }, { status: 400 });
  }

  const { txId, nonce } = payload.payload || {};

  if (!txId) {
    return NextResponse.json({ error: "Missing txId in payment" }, { status: 400 });
  }

  // Verify the transaction on-chain
  try {
    const txResp = await fetch(`${API_URL}/extended/v1/tx/${txId}`);
    if (!txResp.ok) {
      return NextResponse.json(
        { error: "Transaction not found. It may still be pending." },
        { status: 402 }
      );
    }

    const txData = await txResp.json();

    if (txData.tx_status !== "success") {
      return NextResponse.json(
        { error: `Transaction status: ${txData.tx_status}` },
        { status: 402 }
      );
    }

    // Verify it called our contract
    const expectedContract = `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`;
    if (txData.contract_call?.contract_id !== expectedContract) {
      return NextResponse.json(
        { error: "Payment was not to the correct contract" },
        { status: 402 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Verification failed: ${err}` },
      { status: 500 }
    );
  }

  // Payment verified — return the token analysis
  const token = request.nextUrl.searchParams.get("token") || "STX";

  // Fetch real data from Hiro API
  const analysis = await fetchTokenAnalysis(token);

  return NextResponse.json(
    {
      success: true,
      paymentTx: txId,
      analysis,
    },
    {
      headers: {
        "PAYMENT-RESPONSE": Buffer.from(
          JSON.stringify({
            success: true,
            transaction: txId,
            network: "stacks:2147483648",
          })
        ).toString("base64"),
      },
    }
  );
}

async function fetchTokenAnalysis(token: string) {
  const now = new Date().toISOString();

  // Fetch STX supply info
  let supply = { total: "0", unlocked: "0", locked: "0" };
  try {
    const resp = await fetch(`${API_URL}/extended/v1/stx_supply`);
    if (resp.ok) {
      const data = await resp.json();
      supply = {
        total: data.total_stx || "0",
        unlocked: data.unlocked_stx || "0",
        locked: data.locked_stx || "0",
      };
    }
  } catch {}

  // Fetch recent blocks for activity metrics
  let recentBlocks: Array<{ height: number; txCount: number; time: string }> = [];
  try {
    const resp = await fetch(`${API_URL}/extended/v2/blocks?limit=10`);
    if (resp.ok) {
      const data = await resp.json();
      recentBlocks = (data.results || []).map((b: Record<string, unknown>) => ({
        height: b.height,
        txCount: b.tx_count || (Array.isArray(b.txs) ? b.txs.length : 0),
        time: b.burn_block_time_iso || b.block_time_iso,
      }));
    }
  } catch {}

  // Fetch mempool stats
  let mempool = { pending: 0 };
  try {
    const resp = await fetch(`${API_URL}/extended/v1/tx/mempool/stats`);
    if (resp.ok) {
      const data = await resp.json();
      const counts = data.tx_type_counts || {};
      mempool.pending = Object.values(counts).reduce(
        (sum: number, v) => sum + Number(v || 0),
        0
      );
    }
  } catch {}

  const avgTxPerBlock =
    recentBlocks.length > 0
      ? Math.round(
          recentBlocks.reduce((sum, b) => sum + b.txCount, 0) / recentBlocks.length
        )
      : 0;

  return {
    token,
    network: "stacks-testnet",
    timestamp: now,
    supply: {
      total: `${Number(supply.total).toLocaleString()} STX`,
      unlocked: `${Number(supply.unlocked).toLocaleString()} STX`,
      locked: `${Number(supply.locked).toLocaleString()} STX`,
      percentLocked: supply.total !== "0"
        ? `${((Number(supply.locked) / Number(supply.total)) * 100).toFixed(1)}%`
        : "N/A",
    },
    activity: {
      recentBlocks: recentBlocks.slice(0, 5).map((b) => ({
        height: b.height,
        transactions: b.txCount,
        time: b.time,
      })),
      avgTxPerBlock,
      mempoolPending: mempool.pending,
    },
    protocol: {
      x402Contract: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
      paymentPrice: "0.01 STX",
      network: "stacks:2147483648 (testnet)",
    },
    meta: {
      generatedAt: now,
      paidVia: "x402 micropayment",
      poweredBy: "Hiro API + x402-payments Clarity contract",
    },
  };
}
