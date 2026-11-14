import {
  Account,
  FailoverRpcProvider,
  JsonRpcProvider,
  KeyPairString,
  SCHEMA,
  SignedDelegate,
  actions,
  baseEncode,
  getTransactionLastResult,
  teraToGas,
} from "near-api-js";
import { deserialize } from "borsh";
import { createHash } from "node:crypto";
import { config } from "./config.ts";
import { recordEvents } from "./ledger.ts";

// Fail over across RPC endpoints: public testnet RPCs drop connections often enough to matter.
const rpcUrls = [config.rpcUrl, ...(config.network === "mainnet" ? ["https://rpc.mainnet.near.org"] : ["https://near-testnet.drpc.org", "https://rpc.testnet.near.org"])]
  .filter((u, i, a) => a.indexOf(u) === i);
export const provider = new FailoverRpcProvider(rpcUrls.map((url) => new JsonRpcProvider({ url }, { retries: 2, backoff: 1.5, wait: 300 })));

let _relayer: Account | undefined;
let _agent: Account | undefined;

export function relayer(): Account {
  if (!_relayer) {
    if (!config.relayerAccountId || !config.relayerPrivateKey) throw new HttpError(503, "Relayer is not configured");
    _relayer = new Account(config.relayerAccountId, provider, config.relayerPrivateKey as KeyPairString);
  }
  return _relayer;
}

export function agent(): Account {
  if (!_agent) {
    if (!config.agentAccountId || !config.agentPrivateKey) throw new HttpError(503, "AI agent is not configured");
    _agent = new Account(config.agentAccountId, provider, config.agentPrivateKey as KeyPairString);
  }
  return _agent;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error") {
    super(message);
  }
}

// Short-lived read cache + in-flight de-duplication: dashboards poll many endpoints that fan
// out to the same contract views, and public RPCs rate-limit aggressively. Writes clear it.
const VIEW_TTL_MS = 2500;
const viewCache = new Map<string, { at: number; p: Promise<unknown> }>();
export const invalidateViews = () => viewCache.clear();

export async function view<T>(method: string, args: Record<string, unknown> = {}, contractId = config.contractId): Promise<T> {
  const key = `${contractId}|${method}|${JSON.stringify(args)}`;
  const hit = viewCache.get(key);
  if (hit && Date.now() - hit.at < VIEW_TTL_MS) return hit.p as Promise<T>;
  const p = provider.callFunction({ contractId, method, args }).catch((e: Error) => {
    viewCache.delete(key);
    if (/Exceeded \d+ providers|fetch failed|ETIMEDOUT|ECONNRESET|429/.test(e.message)) {
      throw new HttpError(503, "The NEAR network is briefly unreachable. Please retry in a moment.", "network_unavailable");
    }
    throw e;
  });
  viewCache.set(key, { at: Date.now(), p });
  if (viewCache.size > 2000) viewCache.clear();
  return p as Promise<T>;
}

export interface CallResult<T> {
  txHash: string;
  value: T;
  logs: string[];
}

/** Sign and send a function call from one of the server's accounts, returning the decoded return value. */
export async function call<T = unknown>(
  signer: Account,
  method: string,
  args: Record<string, unknown>,
  opts: { contractId?: string; deposit?: bigint; tgas?: number } = {},
): Promise<CallResult<T>> {
  const res = await signAndSend(signer, opts.contractId ?? config.contractId, [
    actions.functionCall(method, args, teraToGas(opts.tgas ?? 100), opts.deposit ?? 0n),
  ]);
  const r = res as any;
  if (r.status?.Failure) throw new Error(`Transaction failed: ${JSON.stringify(r.status.Failure)}`);
  const logs: string[] = [
    ...(r.transaction_outcome?.outcome?.logs ?? []),
    ...((r.receipts_outcome ?? []) as any[]).flatMap((o) => o.outcome?.logs ?? []),
  ];
  const txHash = r.transaction?.hash ?? r.transaction_outcome?.id;
  invalidateViews();
  await recordEvents(settleEvents(logs), txHash, signer.accountId);
  return { txHash, value: getTransactionLastResult(res as any) as T, logs };
}

/**
 * Sign first so the transaction hash is known before it's sent: if the RPC errors after broadcasting (rate limits,
 * timeouts, dropped connections), look the transaction up by hash instead of reporting a failure for a transaction
 * that actually landed, and losing its events.
 */
async function signAndSend(signer: Account, receiverId: string, acts: ReturnType<typeof actions.functionCall>[]) {
  const signed = await signer.createSignedTransaction({ receiverId, actions: acts });
  const hash = baseEncode(createHash("sha256").update(signed.transaction.encode()).digest());
  try {
    return await provider.sendTransactionUntil(signed, "EXECUTED_OPTIMISTIC");
  } catch (e) {
    const err = e as Error;
    // The network refused the transaction outright: it never landed, so there is nothing to look up.
    if (/NotEnoughBalance|LackBalanceForState/.test(`${err.name} ${err.message}`)) {
      console.error(`[near] ${signer.accountId} cannot pay for this transaction: ${err.message.slice(0, 160)}`);
      throw new HttpError(503, `Settle's gas account (${signer.accountId}) is out of NEAR. Top it up from a testnet faucet and retry.`, "relayer_out_of_funds");
    }
    if (/InvalidTxError|InvalidSignature|InvalidAccessKey|Expired|InvalidNonce|DelegateAction/.test(`${err.name} ${err.message}`)) throw err;
    return recoverTx(hash, signer.accountId, err);
  }
}

async function recoverTx(txHash: string, accountId: string, cause: Error) {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1500 + i * 1000));
    try {
      const out = (await provider.viewTransactionStatus({ txHash, accountId, waitUntil: "EXECUTED_OPTIMISTIC" })) as any;
      if (out?.transaction_outcome) {
        console.warn(`[near] recovered ${txHash} after send error: ${cause.message.slice(0, 80)}`);
        return out; // callers decide what a Failure status means
      }
    } catch {
      /* not visible yet, or the RPC is still unhappy: retry */
    }
  }
  throw cause;
}

/** Parse NEP-297 Settle events from logs. */
export function settleEvents(logs: string[]): { event: string; data: any }[] {
  return logs
    .filter((l) => l.startsWith("EVENT_JSON:"))
    .map((l) => {
      try {
        const e = JSON.parse(l.slice("EVENT_JSON:".length));
        return e.standard === "settle" ? { event: e.event, data: e.data?.[0] } : null;
      } catch {
        return null;
      }
    })
    .filter((e): e is { event: string; data: any } => e !== null);
}

// ------------------------------------------------------------- meta transactions

const ONE_YOCTO = 1n;
const STORAGE_DEPOSIT = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR
const MAX_GAS = teraToGas(300);

export function decodeSignedDelegate(b64: string): SignedDelegate {
  try {
    return deserialize(SCHEMA.SignedDelegate, Buffer.from(b64, "base64")) as unknown as SignedDelegate;
  } catch {
    throw new HttpError(400, "signed_delegate is not a valid base64 borsh SignedDelegate", "invalid_delegate");
  }
}

function decodeArgs(bytes: Uint8Array): any {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return {};
  }
}

/**
 * The relayer only sponsors gas for Settle-related calls, so it can't be drained:
 *  - receiver must be the Settle contract or an accepted token
 *  - every action must be a FunctionCall
 *  - deposits are capped (1 yocto security deposits, or one storage registration)
 *  - token calls may only move tokens *into* Settle or register storage
 */
export async function validateDelegate(sd: SignedDelegate, acceptedTokens: string[]) {
  const da = sd.delegateAction;
  const receiver = da.receiverId;
  const isSettle = receiver === config.contractId;
  const isToken = acceptedTokens.includes(receiver);
  if (!isSettle && !isToken) throw new HttpError(403, `Relayer does not sponsor calls to ${receiver}`, "relay_forbidden");
  if (da.actions.length === 0 || da.actions.length > 4) throw new HttpError(400, "1-4 actions per meta transaction");

  let gas = 0n;
  for (const a of da.actions) {
    const fc = a.functionCall;
    if (!fc) throw new HttpError(403, "Only function calls can be relayed", "relay_forbidden");
    gas += BigInt(fc.gas);
    const deposit = BigInt(fc.deposit);
    const method = fc.methodName;
    if (isSettle) {
      const cap = method === "withdraw" ? STORAGE_DEPOSIT + ONE_YOCTO : ONE_YOCTO;
      if (deposit > cap) throw new HttpError(403, `Deposit too large for ${method}`, "relay_forbidden");
    } else {
      if (method === "ft_transfer_call") {
        const args = decodeArgs(fc.args);
        if (args.receiver_id !== config.contractId) throw new HttpError(403, "Tokens may only be sent to Settle", "relay_forbidden");
        if (deposit > ONE_YOCTO) throw new HttpError(403, "Deposit too large", "relay_forbidden");
      } else if (method === "storage_deposit") {
        if (deposit > STORAGE_DEPOSIT) throw new HttpError(403, "Deposit too large", "relay_forbidden");
      } else {
        throw new HttpError(403, `Relayer does not sponsor ${receiver}.${method}`, "relay_forbidden");
      }
    }
  }
  if (gas > MAX_GAS) throw new HttpError(400, "Too much gas requested");

  const height = (await provider.viewBlock({ finality: "final" }) as any).header.height as number;
  if (BigInt(da.maxBlockHeight) < BigInt(height)) throw new HttpError(400, "Meta transaction expired", "delegate_expired");
}

export async function relaySignedDelegate(sd: SignedDelegate) {
  // Same as relayer().relayMetaTransaction(sd), but recoverable when the RPC errors after broadcasting.
  const res = await signAndSend(relayer(), sd.delegateAction.senderId, [actions.signedDelegate(sd)]);
  const r = res as any;
  const logs: string[] = ((r.receipts_outcome ?? []) as any[]).flatMap((o) => o.outcome?.logs ?? []);
  const failure = ((r.receipts_outcome ?? []) as any[]).find((o) => o.outcome?.status?.Failure)?.outcome?.status?.Failure;
  // In a meta transaction the tx result is the (empty) delegate receipt; the real return
  // value lives in the first receipt executed by the inner receiver.
  let value: unknown = null;
  const inner = ((r.receipts_outcome ?? []) as any[]).find(
    (o) => o.outcome?.executor_id === sd.delegateAction.receiverId && typeof o.outcome?.status?.SuccessValue === "string",
  );
  if (inner?.outcome.status.SuccessValue) {
    try {
      value = JSON.parse(Buffer.from(inner.outcome.status.SuccessValue, "base64").toString("utf8"));
    } catch {
      value = null;
    }
  }
  invalidateViews();
  await recordEvents(settleEvents(logs), (r.transaction?.hash ?? r.transaction_outcome?.id) ?? null, sd.delegateAction.senderId);
  return {
    txHash: (r.transaction?.hash ?? r.transaction_outcome?.id) as string,
    senderId: sd.delegateAction.senderId,
    receiverId: sd.delegateAction.receiverId,
    value,
    logs,
    events: settleEvents(logs),
    failure: failure ? JSON.stringify(failure) : null,
  };
}

// ----------------------------------------------------------------------- tokens

export interface TokenInfo {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  icon?: string | null;
}

const tokenCache = new Map<string, TokenInfo>();

export async function tokenInfo(id: string): Promise<TokenInfo> {
  const cached = tokenCache.get(id);
  if (cached) return cached;
  try {
    const m = await view<any>("ft_metadata", {}, id);
    const info = { id, symbol: m.symbol, name: m.name, decimals: m.decimals, icon: m.icon ?? null };
    tokenCache.set(id, info);
    return info;
  } catch {
    return { id, symbol: id.split(".")[0].slice(0, 8).toUpperCase(), name: id, decimals: 6 };
  }
}

let acceptedCache: { at: number; tokens: string[] } | undefined;
export async function acceptedTokens(): Promise<string[]> {
  if (acceptedCache && Date.now() - acceptedCache.at < 60_000) return acceptedCache.tokens;
  const cfg = await view<{ tokens: string[] }>("get_config");
  acceptedCache = { at: Date.now(), tokens: cfg.tokens };
  return cfg.tokens;
}

/** "12.5" -> 12500000n for 6 decimals. */
export function toBase(amount: string | number, decimals: number): bigint {
  const s = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new HttpError(400, `Invalid amount: ${s}`, "invalid_amount");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new HttpError(400, `Too many decimal places (max ${decimals})`, "invalid_amount");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** 12500000n -> "12.5" */
export function fromBase(base: string | bigint, decimals: number): string {
  const v = BigInt(base);
  const d = 10n ** BigInt(decimals);
  const frac = (v % d).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${v / d}.${frac}` : `${v / d}`;
}

export const explorerTx = (hash: string) => `${config.explorerUrl}/txns/${hash}`;
