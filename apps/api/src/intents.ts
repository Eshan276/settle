/**
 * NEAR Intents (1Click API) integration: lets a customer pay a Settle invoice from any
 * chain/asset. We request an EXACT_OUTPUT quote that delivers the invoice token on NEAR to
 * our settlement account; once 1Click reports SUCCESS, the settlement account forwards the
 * funds into the invoice with `ft_transfer_call(..., {"action":"pay_invoice"})`.
 *
 * NEAR Intents has no testnet, so `INTENTS_MODE=simulated` (the testnet default) fakes
 * the quote and the swap lifecycle while keeping the on-chain settlement real.
 */
import { randomBytes } from "node:crypto";
import { config } from "./config.ts";
import { HttpError } from "./near.ts";

export interface IntentToken {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  price: number;
  contractAddress?: string;
}

export interface IntentQuote {
  depositAddress: string;
  amountIn: string;
  amountInFormatted: string;
  amountOut: string;
  amountOutFormatted: string;
  deadline: string;
  timeEstimate: number;
  raw: unknown;
}

export type IntentStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "PROCESSING"
  | "SUCCESS"
  | "INCOMPLETE_DEPOSIT"
  | "REFUNDED"
  | "FAILED";

const SIMULATED_TOKENS: IntentToken[] = [
  { assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", symbol: "USDC", blockchain: "base", decimals: 6, price: 1 },
  { assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", symbol: "USDC", blockchain: "arb", decimals: 6, price: 1 },
  { assetId: "nep141:eth.omft.near", symbol: "ETH", blockchain: "eth", decimals: 18, price: 3150 },
  { assetId: "nep141:sol.omft.near", symbol: "SOL", blockchain: "sol", decimals: 9, price: 168 },
  { assetId: "nep141:btc.omft.near", symbol: "BTC", blockchain: "btc", decimals: 8, price: 96000 },
  { assetId: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", symbol: "USDT", blockchain: "tron", decimals: 6, price: 1 },
  { assetId: "nep141:wrap.near", symbol: "wNEAR", blockchain: "near", decimals: 24, price: 3.4 },
];

const headers = () => ({
  "content-type": "application/json",
  ...(config.oneClickJwt ? { authorization: `Bearer ${config.oneClickJwt}` } : {}),
});

let tokenCache: { at: number; tokens: IntentToken[] } | undefined;

export async function listTokens(): Promise<IntentToken[]> {
  if (config.intentsMode === "simulated") return SIMULATED_TOKENS;
  if (tokenCache && Date.now() - tokenCache.at < 10 * 60_000) return tokenCache.tokens;
  const res = await fetch(`${config.oneClickBaseUrl}/v0/tokens`, { headers: headers() });
  if (!res.ok) throw new HttpError(502, `1Click /tokens failed: ${res.status}`, "intents_unavailable");
  const tokens = ((await res.json()) as any[]).map((t) => ({
    assetId: t.assetId,
    symbol: t.symbol,
    blockchain: t.blockchain,
    decimals: t.decimals,
    price: Number(t.price ?? 0),
    contractAddress: t.contractAddress,
  }));
  tokenCache = { at: Date.now(), tokens };
  return tokens;
}

function formatUnits(v: bigint, decimals: number, maxFrac = 8) {
  const d = 10n ** BigInt(decimals);
  const frac = (v % d).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  return frac ? `${v / d}.${frac}` : `${v / d}`;
}

export async function quote(params: {
  originAsset: string;
  destinationTokenId: string;
  amountOut: bigint;
  destinationDecimals: number;
  refundTo: string;
  recipient: string;
}): Promise<IntentQuote> {
  const deadline = new Date(Date.now() + 30 * 60_000).toISOString();
  if (config.intentsMode === "simulated") {
    const token = SIMULATED_TOKENS.find((t) => t.assetId === params.originAsset);
    if (!token) throw new HttpError(400, "Unsupported origin asset", "invalid_asset");
    const usd = Number(params.amountOut) / 10 ** params.destinationDecimals;
    const amountInFloat = (usd / token.price) * 1.003; // ~0.3% solver spread
    const amountIn = BigInt(Math.ceil(amountInFloat * 10 ** Math.min(token.decimals, 15))) * 10n ** BigInt(Math.max(0, token.decimals - 15));
    return {
      depositAddress: `sim${randomBytes(20).toString("hex")}`,
      amountIn: amountIn.toString(),
      amountInFormatted: formatUnits(amountIn, token.decimals),
      amountOut: params.amountOut.toString(),
      amountOutFormatted: formatUnits(params.amountOut, params.destinationDecimals),
      deadline,
      timeEstimate: 20,
      raw: { simulated: true },
    };
  }

  const body = {
    dry: false,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: params.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: `nep141:${params.destinationTokenId}`,
    amount: params.amountOut.toString(),
    refundTo: params.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: params.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline,
    referral: "settle",
  };
  const res = await fetch(`${config.oneClickBaseUrl}/v0/quote`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new HttpError(502, `1Click quote failed: ${json?.message ?? res.status}`, "intents_quote_failed");
  const q = json.quote ?? {};
  return {
    depositAddress: q.depositAddress,
    amountIn: q.amountIn,
    amountInFormatted: q.amountInFormatted,
    amountOut: q.amountOut,
    amountOutFormatted: q.amountOutFormatted,
    deadline: q.deadline ?? deadline,
    timeEstimate: q.timeEstimate ?? 60,
    raw: json,
  };
}

export async function status(depositAddress: string): Promise<{ status: IntentStatus; amountOut?: string; raw: unknown }> {
  const res = await fetch(`${config.oneClickBaseUrl}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`, { headers: headers() });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new HttpError(502, `1Click status failed: ${res.status}`, "intents_unavailable");
  return { status: json.status, amountOut: json.swapDetails?.amountOut, raw: json };
}

export async function submitDepositTx(depositAddress: string, txHash: string) {
  if (config.intentsMode === "simulated") return;
  await fetch(`${config.oneClickBaseUrl}/v0/deposit/submit`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ depositAddress, txHash }),
  }).catch(() => undefined);
}
