"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";

const DemoClient = dynamic(() => import("./demo-client"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] text-zinc-500 text-sm">
      Loading x402 demo...
    </div>
  ),
});

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: Error) {
    return { error: err.message };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0a0a0a] text-zinc-300 px-6">
          <h1 className="text-lg font-bold text-red-400">
            Failed to load demo
          </h1>
          <p className="text-sm text-zinc-500 max-w-md text-center">
            {this.state.error}
          </p>
          <p className="text-xs text-zinc-600">
            Make sure you have a Stacks wallet extension (Leather) installed.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded border border-zinc-700 px-4 py-2 text-sm hover:border-zinc-500"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Home() {
  return (
    <ErrorBoundary>
      <DemoClient />
    </ErrorBoundary>
  );
}
