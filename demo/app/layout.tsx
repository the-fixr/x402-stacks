import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://x402-stacks.fixr.nexus";
const TITLE = "x402 on Stacks — HTTP Micropayments";
const DESCRIPTION =
  "First x402 micropayment protocol on Stacks. Pay 0.01 STX to access gated API endpoints. Clarity smart contract with nonce replay protection and Stacks post-conditions.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s | x402 on Stacks",
  },
  description: DESCRIPTION,
  keywords: [
    "x402",
    "Stacks",
    "STX",
    "micropayments",
    "HTTP 402",
    "Clarity",
    "smart contract",
    "pay-per-call",
    "API monetization",
    "Bitcoin L2",
    "web3",
  ],
  authors: [{ name: "Fixr", url: "https://github.com/the-fixr" }],
  creator: "Fixr",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    siteName: "x402 on Stacks",
    images: [
      {
        url: "/og",
        width: 1200,
        height: 630,
        alt: "x402 on Stacks — HTTP micropayments via Clarity smart contracts",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og"],
    creator: "@thefixr_",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  alternates: { canonical: SITE_URL },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
