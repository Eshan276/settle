import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Minimal .env loader (no dependency). Real env vars win.
for (const file of [".env.local", ".env"]) {
  const p = resolve(process.cwd(), file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const env = (k: string, d?: string) => process.env[k] ?? d;

export type Network = "testnet" | "mainnet";
const network = (env("NEAR_NETWORK", "testnet") as Network);

export const config = {
  port: Number(env("PORT", "4000")),
  network,
  rpcUrl: env("NEAR_RPC_URL", network === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com")!,
  explorerUrl: network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io",
  contractId: env("SETTLE_CONTRACT_ID", "")!,
  /** Pays gas for meta transactions, creates user accounts, acts as operator + intents settlement account. */
  relayerAccountId: env("RELAYER_ACCOUNT_ID", "")!,
  relayerPrivateKey: env("RELAYER_PRIVATE_KEY", "")!,
  /** The AI AP agent. Should only hold a function-call key for agent_pay/agent_pay_invoice. */
  agentAccountId: env("AGENT_ACCOUNT_ID") || env("RELAYER_ACCOUNT_ID", "")!,
  agentPrivateKey: env("AGENT_PRIVATE_KEY") || env("RELAYER_PRIVATE_KEY", "")!,
  defaultTokenId: env("DEFAULT_TOKEN_ID", "")!,
  /** "live" uses the real 1Click API (mainnet only). "simulated" fakes cross-chain settlement for testnet demos. */
  intentsMode: (env("INTENTS_MODE", network === "mainnet" ? "live" : "simulated") as "live" | "simulated"),
  oneClickBaseUrl: env("ONECLICK_BASE_URL", "https://1click.chaindefuser.com")!,
  oneClickJwt: env("ONECLICK_JWT", ""),
  anthropicModel: env("ANTHROPIC_MODEL", "claude-opus-5-5")!,
  aiEnabled: Boolean(env("ANTHROPIC_API_KEY") || env("ANTHROPIC_AUTH_TOKEN")),
  webUrl: env("PUBLIC_WEB_URL") || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000"),
  /** Postgres connection string (Neon's Vercel integration sets DATABASE_URL / POSTGRES_URL). */
  databaseUrl: env("DATABASE_URL") || env("POSTGRES_URL") || "",
  watcherIntervalMs: Number(env("WATCHER_INTERVAL_MS", "4000")),
  newAccountNear: env("NEW_ACCOUNT_NEAR", "0.02")!,
};

export function assertChainConfig() {
  const missing = ["contractId", "relayerAccountId", "relayerPrivateKey", "defaultTokenId"].filter(
    (k) => !(config as Record<string, unknown>)[k],
  );
  if (missing.length) {
    console.warn(`[settle] missing chain config: ${missing.join(", ")} — run \`pnpm deploy:testnet\` first. Chain routes will fail.`);
  }
}
