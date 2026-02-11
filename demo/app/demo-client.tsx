"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
// Dynamic imports at call-time to avoid webpack chunk-splitting issues
// with @stacks/connect-ui Lit web components in production builds.
// Type-only imports are safe (erased at compile time).
import type { StxPostCondition } from "@stacks/transactions";

const CONTRACT_ADDRESS = "ST356P5YEXBJC1ZANBWBNR0N0X7NT8AV7FZ017K55";
const CONTRACT_NAME = "x402-payments";
const CONTRACT_ID = `${CONTRACT_ADDRESS}.${CONTRACT_NAME}` as const;
// Separate treasury address -- avoids self-payment rejection when payer is deployer
const PAY_TO = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";
const API_URL = "https://api.testnet.hiro.so";

type Step = {
  id: number;
  label: string;
  description: string;
  status: "pending" | "active" | "done" | "error";
  detail?: string;
};

const INITIAL_STEPS: Step[] = [
  {
    id: 1,
    label: "Request Resource",
    description: "GET /api/analyze -- requesting gated data without payment",
    status: "pending",
  },
  {
    id: 2,
    label: "402 Payment Required",
    description:
      "Server responds with HTTP 402 + PAYMENT-REQUIRED header containing price, contract, and network",
    status: "pending",
  },
  {
    id: 3,
    label: "Connect Wallet",
    description:
      "Open wallet to authorize the session -- no private keys leave the extension",
    status: "pending",
  },
  {
    id: 4,
    label: "Sign Payment",
    description:
      "Call x402-payments.pay-stx with a unique nonce -- Stacks post-conditions guarantee exact amount",
    status: "pending",
  },
  {
    id: 5,
    label: "Await Confirmation",
    description:
      "Poll Hiro API for transaction confirmation on Stacks testnet (~30-60s block time)",
    status: "pending",
  },
  {
    id: 6,
    label: "Retry with Proof",
    description:
      "Re-send GET /api/analyze with PAYMENT-SIGNATURE header containing txId + nonce",
    status: "pending",
  },
  {
    id: 7,
    label: "Access Granted",
    description:
      "Server verifies on-chain payment, returns token analysis data + PAYMENT-RESPONSE header",
    status: "pending",
  },
];

function generateNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function waitForTx(
  txId: string
): Promise<"success" | "abort_by_response" | "pending"> {
  const resp = await fetch(`${API_URL}/extended/v1/tx/${txId}`);
  if (!resp.ok) return "pending";
  const data = await resp.json();
  if (data.tx_status === "success") return "success";
  if (data.tx_status === "abort_by_response") return "abort_by_response";
  return "pending";
}

// Step card component
function StepCard({ step, index }: { step: Step; index: number }) {
  const statusColors = {
    pending: "border-zinc-800 bg-zinc-900/50",
    active: "border-indigo-500 bg-indigo-950/30 animate-pulse-border",
    done: "border-emerald-500/60 bg-emerald-950/20",
    error: "border-red-500/60 bg-red-950/20",
  };

  const statusIcons = {
    pending: <span className="text-zinc-600">{">"}</span>,
    active: <span className="text-indigo-400 cursor-blink">{">"}</span>,
    done: <span className="text-emerald-400">ok</span>,
    error: <span className="text-red-400">err</span>,
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`rounded border p-4 transition-all duration-500 ${statusColors[step.status]}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 w-8 shrink-0 text-xs font-bold">
          {statusIcons[step.status]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">
              [{String(step.id).padStart(2, "0")}]
            </span>
            <span
              className={`text-sm font-semibold ${
                step.status === "active"
                  ? "text-indigo-300"
                  : step.status === "done"
                  ? "text-emerald-300"
                  : step.status === "error"
                  ? "text-red-300"
                  : "text-zinc-400"
              }`}
            >
              {step.label}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            {step.description}
          </p>
          {step.detail && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="mt-2 overflow-hidden rounded bg-black/60 px-3 py-2"
            >
              <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed text-zinc-400">
                {step.detail}
              </pre>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function DemoClient() {
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [analysisData, setAnalysisData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const updateStep = useCallback(
    (id: number, updates: Partial<Step>) => {
      setSteps((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
      );
    },
    []
  );

  const reset = useCallback(() => {
    setSteps(INITIAL_STEPS);
    setAnalysisData(null);
    setError(null);
  }, []);

  // Auto-scroll to active step
  useEffect(() => {
    const active = steps.find((s) => s.status === "active");
    if (active) {
      const el = document.getElementById(`step-${active.id}`);
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [steps]);

  const connectWallet = useCallback(async (): Promise<string> => {
    const { connect } = await import("@stacks/connect");
    const result = await connect({ network: "testnet" });
    // Find a testnet (ST...) address from the returned addresses
    const stxAddr = result.addresses.find((a) =>
      a.address.startsWith("ST")
    );
    const addr = stxAddr?.address || result.addresses[0]?.address || "";
    if (!addr) throw new Error("No address returned from wallet");
    setWalletAddress(addr);
    return addr;
  }, []);

  const disconnectWallet = useCallback(() => {
    setWalletAddress(null);
    reset();
  }, [reset]);

  const runDemo = useCallback(async () => {
    if (running) return;
    setRunning(true);
    reset();
    setError(null);

    try {
      // Step 1: Request resource without payment
      updateStep(1, { status: "active" });
      await new Promise((r) => setTimeout(r, 800));

      const initialResp = await fetch("/api/analyze?token=STX");
      const initialBody = await initialResp.json();

      updateStep(1, {
        status: "done",
        detail: `HTTP ${initialResp.status} ${initialResp.statusText}\n${JSON.stringify(initialBody, null, 2)}`,
      });

      // Step 2: Parse 402 response
      updateStep(2, { status: "active" });
      await new Promise((r) => setTimeout(r, 600));

      const paymentHeader = initialResp.headers.get("PAYMENT-REQUIRED");
      let paymentReq: Record<string, unknown> | null = null;
      if (paymentHeader) {
        try {
          paymentReq = JSON.parse(atob(paymentHeader));
        } catch {
          paymentReq = null;
        }
      }

      updateStep(2, {
        status: "done",
        detail: paymentReq
          ? `PAYMENT-REQUIRED header decoded:\n${JSON.stringify(paymentReq, null, 2)}`
          : `No PAYMENT-REQUIRED header (status=${initialResp.status}).\nProceeding with known contract parameters.`,
      });

      // Step 3: Connect wallet (skip if already connected)
      updateStep(3, { status: "active" });
      let addr = walletAddress;
      if (!addr) {
        try {
          addr = await connectWallet();
        } catch (err) {
          updateStep(3, {
            status: "error",
            detail: `Wallet connection failed: ${err}`,
          });
          setError("Wallet connection failed. Please try again.");
          setRunning(false);
          return;
        }
      }
      updateStep(3, {
        status: "done",
        detail: `Connected: ${addr}${walletAddress ? " (already connected)" : ""}`,
      });

      // Step 4: Sign payment transaction via stx_callContract RPC
      updateStep(4, { status: "active" });
      const nonce = generateNonce();
      const nonceHex = toHex(nonce);
      const amount = 10000; // 0.01 STX in microSTX

      updateStep(4, {
        status: "active",
        detail: `Nonce: 0x${nonceHex}\nAmount: ${amount} microSTX (0.01 STX)\nContract: ${CONTRACT_ID}\nRecipient: ${PAY_TO}\nFunction: pay-stx(recipient, amount, nonce)\n\nOpening wallet for signature...`,
      });

      const { request } = await import("@stacks/connect");
      const { uintCV, bufferCV, standardPrincipalCV } = await import(
        "@stacks/transactions"
      );

      const stxPostCondition: StxPostCondition = {
        type: "stx-postcondition",
        address: addr!,
        condition: "lte",
        amount: amount,
      };

      const txResult = await request("stx_callContract", {
        contract: CONTRACT_ID,
        functionName: "pay-stx",
        functionArgs: [
          standardPrincipalCV(PAY_TO),
          uintCV(amount),
          bufferCV(nonce),
        ],
        postConditionMode: "deny",
        postConditions: [stxPostCondition],
        network: "testnet",
      });

      const txId = txResult.txid;
      if (!txId) {
        updateStep(4, {
          status: "error",
          detail: `No txid returned from wallet.\nResult: ${JSON.stringify(txResult)}`,
        });
        setError("Wallet did not return a transaction ID.");
        setRunning(false);
        return;
      }

      updateStep(4, {
        status: "done",
        detail: `Transaction signed and broadcast!\ntxId: ${txId}\nNonce: 0x${nonceHex}\n\nPost-condition: sender transfers <= ${amount} microSTX (enforced by Stacks)`,
      });

      // Step 5: Wait for confirmation
      updateStep(5, { status: "active" });
      let confirmed = false;
      let polls = 0;
      const maxPolls = 60;

      while (!confirmed && polls < maxPolls) {
        polls++;
        updateStep(5, {
          status: "active",
          detail: `Polling tx status... attempt ${polls}/${maxPolls}\ntxId: ${txId}`,
        });

        const status = await waitForTx(txId);
        if (status === "success") {
          confirmed = true;
          break;
        }
        if (status === "abort_by_response") {
          updateStep(5, {
            status: "error",
            detail: `Transaction aborted on-chain.\ntxId: ${txId}`,
          });
          setError("Transaction was aborted on-chain.");
          setRunning(false);
          return;
        }

        await new Promise((r) => setTimeout(r, 5000));
      }

      if (!confirmed) {
        updateStep(5, {
          status: "error",
          detail: `Transaction not confirmed after ${maxPolls} attempts.\ntxId: ${txId}\nIt may still confirm -- check the explorer.`,
        });
        setError("Transaction not confirmed in time. Try again later.");
        setRunning(false);
        return;
      }

      updateStep(5, {
        status: "done",
        detail: `Confirmed on-chain!\ntxId: ${txId}\nBlock included in Stacks testnet.`,
      });

      // Step 6: Retry with payment proof
      updateStep(6, { status: "active" });
      const paymentPayload = {
        x402Version: 2,
        scheme: "exact",
        network: "stacks:2147483648",
        payload: {
          txId,
          nonce: nonceHex,
        },
      };
      const encoded = btoa(JSON.stringify(paymentPayload));

      updateStep(6, {
        status: "active",
        detail: `PAYMENT-SIGNATURE header:\n${JSON.stringify(paymentPayload, null, 2)}\n\nBase64-encoded and attached to retry request...`,
      });

      await new Promise((r) => setTimeout(r, 500));

      const paidResp = await fetch("/api/analyze?token=STX", {
        headers: {
          "PAYMENT-SIGNATURE": encoded,
        },
      });
      const paidBody = await paidResp.json();

      if (!paidResp.ok) {
        updateStep(6, {
          status: "error",
          detail: `Server rejected payment proof:\nHTTP ${paidResp.status}\n${JSON.stringify(paidBody, null, 2)}`,
        });
        setError(`Server rejected payment: ${paidBody.error}`);
        setRunning(false);
        return;
      }

      updateStep(6, {
        status: "done",
        detail: `HTTP ${paidResp.status} OK\nServer verified on-chain payment and returned data.`,
      });

      // Step 7: Show result
      updateStep(7, { status: "active" });
      await new Promise((r) => setTimeout(r, 400));

      setAnalysisData(paidBody);
      updateStep(7, {
        status: "done",
        detail: `Full analysis received. Payment verified via x402 protocol.\n\nResponse includes PAYMENT-RESPONSE header confirming settlement.`,
      });
    } catch (err) {
      setError(`${err}`);
      const active = stepsRef.current.find((s) => s.status === "active");
      if (active) {
        updateStep(active.id, {
          status: "error",
          detail: `Error: ${err}`,
        });
      }
    } finally {
      setRunning(false);
    }
  }, [running, walletAddress, connectWallet, reset, updateStep]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-300">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-zinc-100">
              x402 on Stacks
            </h1>
            <p className="text-xs text-zinc-500">
              HTTP 402 micropayments -- first implementation on Stacks
            </p>
          </div>
          <div className="flex items-center gap-3">
            {walletAddress ? (
              <>
                <span className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400">
                  {walletAddress.slice(0, 8)}...{walletAddress.slice(-4)}
                </span>
                <button
                  onClick={disconnectWallet}
                  className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-500 hover:border-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={connectWallet}
                className="rounded border border-indigo-500/60 bg-indigo-600/20 px-3 py-1 text-xs font-semibold text-indigo-300 hover:bg-indigo-600/40 transition-colors"
              >
                Connect Wallet
              </button>
            )}
            <span className="rounded-full bg-emerald-900/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
              testnet
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Intro */}
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h2 className="mb-2 text-2xl font-bold text-zinc-100">
            Pay-per-call API demo
          </h2>
          <p className="text-sm leading-relaxed text-zinc-500">
            This demo gates a live Stacks token analysis endpoint behind an x402
            micropayment of{" "}
            <span className="font-semibold text-indigo-400">0.01 STX</span>.
            Each step of the protocol is shown as it executes. The payment flows
            through a{" "}
            <span className="text-zinc-300">Clarity smart contract</span>{" "}
            deployed on testnet with nonce-based replay protection and Stacks
            post-conditions.
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs text-zinc-600">
            <span>Contract:</span>
            <a
              href={`https://explorer.hiro.so/txid/${CONTRACT_ID}?chain=testnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 underline decoration-indigo-400/30"
            >
              {CONTRACT_ID}
            </a>
          </div>
        </motion.section>

        {/* Action button */}
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={runDemo}
            disabled={running}
            className={`rounded border px-5 py-2 text-sm font-semibold transition-all ${
              running
                ? "cursor-not-allowed border-zinc-700 bg-zinc-800 text-zinc-500"
                : "border-indigo-500 bg-indigo-600 text-white hover:bg-indigo-500"
            }`}
          >
            {running ? "Running..." : "Run x402 Flow"}
          </button>
          {!running && analysisData && (
            <button
              onClick={reset}
              className="rounded border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-300"
            >
              Reset
            </button>
          )}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>

        {/* Steps */}
        <div className="space-y-3">
          {steps.map((step, i) => (
            <div key={step.id} id={`step-${step.id}`}>
              <StepCard step={step} index={i} />
            </div>
          ))}
        </div>

        {/* Analysis result */}
        <AnimatePresence>
          {analysisData && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-8 rounded border border-emerald-500/30 bg-emerald-950/10 p-6"
            >
              <h3 className="mb-3 text-sm font-bold text-emerald-400">
                Token Analysis (paid via x402)
              </h3>
              <pre className="whitespace-pre-wrap break-all text-xs leading-relaxed text-zinc-400">
                {JSON.stringify(analysisData, null, 2)}
              </pre>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Protocol info footer */}
        <section className="mt-12 border-t border-zinc-800 pt-6">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-500">
            How x402 works on Stacks
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              {
                title: "Post-conditions",
                body: "Stacks enforces transfer limits at the protocol level. The wallet guarantees exactly 0.01 STX leaves your account -- no approvals, no hidden drains.",
              },
              {
                title: "Nonce replay protection",
                body: "Each payment includes a random 16-byte nonce stored on-chain. The contract rejects duplicate nonces, preventing double-spend of payment proofs.",
              },
              {
                title: "On-chain verification",
                body: "The server calls verify-payment (a read-only Clarity function) to confirm the payment amount, recipient, and nonce without trusting the client.",
              },
            ].map((card) => (
              <div
                key={card.title}
                className="rounded border border-zinc-800 bg-zinc-900/30 p-4"
              >
                <h4 className="mb-1 text-xs font-semibold text-zinc-300">
                  {card.title}
                </h4>
                <p className="text-[11px] leading-relaxed text-zinc-500">
                  {card.body}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-[11px] text-zinc-500">
            Built by{" "}
            <a
              href="https://fixr.nexus"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 underline decoration-indigo-400/30"
            >
              Fixr
            </a>
            {" "}with Clarity 4 + @stacks/connect + Next.js -- x402 protocol v2
          </p>
        </section>
      </main>
    </div>
  );
}
