import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@settle/sdk", "@settle/api"],
  // Node-only server dependencies of the API: load them from node_modules instead of bundling.
  serverExternalPackages: ["pg", "near-api-js", "@anthropic-ai/sdk"],
  reactStrictMode: true,
};

export default nextConfig;
