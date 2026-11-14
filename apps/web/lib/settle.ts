"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Settle, SettleWallet, fromBase, toBase, formatMoney } from "@settle/sdk";
import type { KeyPairString } from "near-api-js";
import { useToast } from "@/components/toast";

// Empty = same origin: the API is served by this Next.js app at /v1/*. Set NEXT_PUBLIC_API_URL to use a separate API server.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export interface TokenInfo {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
}

export interface SettleConfig {
  network: "testnet" | "mainnet";
  rpc_url: string;
  explorer_url: string;
  contract_id: string;
  relayer_account_id: string;
  agent_account_id: string;
  default_token: TokenInfo;
  tokens: TokenInfo[];
  intents_mode: "live" | "simulated";
  ai_enabled: boolean;
  account_suffix: string;
}

let configPromise: Promise<SettleConfig> | undefined;
export function loadConfig() {
  configPromise ??= new Settle(undefined, { baseUrl: API_URL }).config().catch((e) => {
    configPromise = undefined;
    throw e;
  });
  return configPromise;
}

export function useConfig() {
  return useAsync(loadConfig, []);
}

/**
 * Wallets live in localStorage, one per "slot" so the same browser can act as the business
 * (dashboard) and as a customer (hosted pay page) during a demo.
 * Hackathon trade-off: keys in localStorage. Production would use passkeys / an MPC wallet.
 */
export type Slot = "business" | "payer";
const walletKey = (slot: Slot) => `settle.wallet.${slot}.v1`;
const sessionKey = "settle.session.v1";

export interface StoredWallet {
  accountId: string;
  secretKey: KeyPairString;
}

export function loadStoredWallet(slot: Slot): StoredWallet | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(walletKey(slot)) ?? "null");
  } catch {
    return null;
  }
}

export function storeWallet(slot: Slot, w: StoredWallet | null) {
  if (w) localStorage.setItem(walletKey(slot), JSON.stringify(w));
  else localStorage.removeItem(walletKey(slot));
  if (slot === "business") localStorage.removeItem(sessionKey);
}

export function api(withSession = true) {
  const token = withSession && typeof window !== "undefined" ? localStorage.getItem(sessionKey) ?? undefined : undefined;
  return new Settle(token, { baseUrl: API_URL });
}

export function walletFor(slot: Slot, cfg: SettleConfig, stored = loadStoredWallet(slot)) {
  if (!stored) return null;
  return new SettleWallet(stored.accountId, stored.secretKey, { contractId: cfg.contract_id, rpcUrl: cfg.rpc_url, api: api(slot === "business") });
}

export async function createWallet(slot: Slot, username: string, cfg: SettleConfig) {
  const w = await SettleWallet.create(username, { contractId: cfg.contract_id, rpcUrl: cfg.rpc_url, api: api(false) });
  storeWallet(slot, { accountId: w.accountId, secretKey: w.secretKey });
  return w;
}

// ---------------------------------------------------------------- connect an existing NEAR wallet
// Settle signs gasless NEP-366 delegate actions in the browser, so the browser needs a key on the account. Instead of
// asking for a private key, we generate one here and ask the user's wallet to add its public key to their account
// (MyNearWallet "login" with a public key). The secret never leaves this browser and the key can be removed in the
// wallet at any time. It has to be a full-access key: token transfers attach 1 yoctoNEAR, which function-call keys can't.
const pendingKey = "settle.pending-connect.v1";
export const walletName = "MyNearWallet";
const walletBase = (cfg: SettleConfig) => (cfg.network === "mainnet" ? "https://app.mynearwallet.com" : "https://testnet.mynearwallet.com");

export async function connectWallet(cfg: SettleConfig) {
  const { KeyPair } = await import("near-api-js");
  const kp = KeyPair.fromRandom("ed25519");
  const publicKey = kp.getPublicKey().toString();
  localStorage.setItem(pendingKey, JSON.stringify({ secretKey: kp.toString(), publicKey, at: Date.now() }));
  const back = `${location.origin}/dashboard`;
  const u = new URL("/login/", walletBase(cfg));
  u.searchParams.set("success_url", back);
  u.searchParams.set("failure_url", `${back}?connect=cancelled`);
  u.searchParams.set("public_key", publicKey);
  location.assign(u.href);
}

/** On return from the wallet: check the key really is on the account, then keep it as the business wallet. */
export async function finishWalletConnect(cfg: SettleConfig): Promise<{ accountId?: string; error?: string } | null> {
  const q = new URLSearchParams(location.search);
  const accountId = q.get("account_id");
  const cancelled = q.has("connect") || q.has("errorCode");
  if (!accountId && !cancelled) return null;
  history.replaceState(null, "", location.pathname);
  const pending = JSON.parse(localStorage.getItem(pendingKey) ?? "null") as { secretKey: KeyPairString; publicKey: string; at: number } | null;
  localStorage.removeItem(pendingKey);
  if (cancelled || !accountId) return { error: "The wallet request was cancelled. Nothing was changed." };
  if (!pending || Date.now() - pending.at > 30 * 60_000) return { error: "That wallet approval expired. Try connecting again." };
  const returned = q.get("public_key");
  if (returned && returned !== pending.publicKey) return { error: "The wallet approved a different key. Try connecting again." };
  const { JsonRpcProvider } = await import("near-api-js");
  const rpc = new JsonRpcProvider({ url: cfg.rpc_url });
  for (let i = 0; i < 15; i++) {
    const key = await rpc.viewAccessKey({ accountId, publicKey: pending.publicKey }).catch(() => null);
    if (key) {
      if ((key as { permission?: unknown }).permission !== "FullAccess") return { error: "The wallet added a limited key. Settle needs it to move tokens, so approve full access." };
      storeWallet("business", { accountId, secretKey: pending.secretKey });
      return { accountId };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { error: `Couldn't find the new key on ${accountId}. Try connecting again.` };
}

/** Ensure the dashboard API session is valid, signing in with the wallet key if needed. */
export async function ensureSession(w: SettleWallet) {
  const existing = localStorage.getItem(sessionKey);
  if (existing) {
    try {
      await new Settle(existing, { baseUrl: API_URL }).me();
      return existing;
    } catch {
      /* expired */
    }
  }
  const token = await w.login();
  localStorage.setItem(sessionKey, token);
  return token;
}

// ---------------------------------------------------------------- async state

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], opts: { pollMs?: number } = {}): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const hasData = useRef(false);
  const retries = useRef(0);

  // Inputs changed: drop stale data so consumers never render results for the old inputs.
  useEffect(() => {
    setData(undefined);
    setLoading(true);
    hasData.current = false;
    retries.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    let alive = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    fnRef.current().then(
      (d) => {
        if (!alive) return;
        hasData.current = true;
        retries.current = 0;
        setData(d);
        setError(null);
        setLoading(false);
      },
      (e) => {
        if (!alive) return;
        // Transient network errors on first load: retry with backoff before showing an error.
        if (!hasData.current && retries.current < 3) {
          retries.current += 1;
          retryTimer = setTimeout(() => setTick((x) => x + 1), 1500 * retries.current);
          return;
        }
        setError(e?.message ?? String(e));
        setLoading(false);
      },
    );
    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  useEffect(() => {
    if (!opts.pollMs) return;
    const t = setInterval(() => setTick((x) => x + 1), opts.pollMs);
    return () => clearInterval(t);
  }, [opts.pollMs]);

  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { data, error, loading, reload };
}

/** Run a gasless transaction with consistent pending/success/error feedback. */
export function useTx() {
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, label: string, fn: () => Promise<T>, explorer?: string): Promise<T | undefined> => {
      setPending(key);
      try {
        const res = await fn();
        const hash = (res as any)?.txHash ?? (res as any)?.tx_hash;
        toast({ kind: "success", title: label, href: hash && explorer ? `${explorer}/txns/${hash}` : undefined });
        return res;
      } catch (e: any) {
        toast({ kind: "error", title: "Something went wrong", body: humanError(e) });
        return undefined;
      } finally {
        setPending(null);
      }
    },
    [toast],
  );
  return { run, pending };
}

export function humanError(e: any): string {
  const msg = String(e?.message ?? e);
  const panic = msg.match(/panic_msg: "([^"]+)"|Smart contract panicked: ([^"\\]+)|"([^"]*(?:Insufficient|not|Exceeds|Only|Invalid|expired)[^"]*)"/);
  return (panic?.[1] ?? panic?.[2] ?? panic?.[3] ?? msg).slice(0, 240);
}

export { fromBase, toBase, formatMoney };

export const money = (base: string | bigint, t: TokenInfo) => formatMoney(base, t.decimals, t.symbol);
export const ago = (secs: number) => {
  const d = Math.floor(Date.now() / 1000) - secs;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return new Date(secs * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
