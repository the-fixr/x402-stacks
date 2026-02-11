import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent @stacks/connect-ui web components from being resolved during SSR
  serverExternalPackages: ["@stacks/connect-ui"],
};

export default nextConfig;
