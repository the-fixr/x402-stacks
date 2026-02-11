import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #0a0a0a 0%, #111827 50%, #0a0a0a 100%)",
          fontFamily: "monospace",
          padding: "60px",
        }}
      >
        {/* Top badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            marginBottom: "32px",
          }}
        >
          <div
            style={{
              background: "#4f46e5",
              borderRadius: "9999px",
              padding: "6px 20px",
              color: "#fff",
              fontSize: "18px",
              fontWeight: 700,
              letterSpacing: "0.05em",
            }}
          >
            HTTP 402
          </div>
          <div
            style={{
              background: "#065f46",
              borderRadius: "9999px",
              padding: "6px 20px",
              color: "#6ee7b7",
              fontSize: "18px",
              fontWeight: 700,
              letterSpacing: "0.05em",
            }}
          >
            STACKS TESTNET
          </div>
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: "72px",
            fontWeight: 800,
            color: "#f4f4f5",
            lineHeight: 1.1,
            textAlign: "center",
            marginBottom: "20px",
          }}
        >
          x402 on Stacks
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: "28px",
            color: "#a1a1aa",
            textAlign: "center",
            maxWidth: "800px",
            lineHeight: 1.5,
          }}
        >
          Pay-per-call API micropayments via Clarity smart contracts
        </div>

        {/* Bottom details */}
        <div
          style={{
            display: "flex",
            gap: "40px",
            marginTop: "48px",
            color: "#71717a",
            fontSize: "18px",
          }}
        >
          <span>0.01 STX per call</span>
          <span>|</span>
          <span>Nonce replay protection</span>
          <span>|</span>
          <span>Post-conditions</span>
        </div>

        {/* Footer */}
        <div
          style={{
            position: "absolute",
            bottom: "40px",
            color: "#52525b",
            fontSize: "16px",
          }}
        >
          github.com/the-fixr/x402-stacks
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
