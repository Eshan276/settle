/**
 * Gasless embedded wallet. Every action is signed locally as a NEP-366 delegate action and
 * submitted by the Settle relayer, which pays the gas. Users never need NEAR for fees.
 */
import { Account, JsonRpcProvider, KeyPair, KeyPairString, actions, encodeSignedDelegate, teraToGas } from "near-api-js";
import { Settle } from "./client.ts";

const ONE_YOCTO = 1n;
const STORAGE = 1_250_000_000_000_000_000_000n;

export const loginMessage = (accountId: string, timestamp: number) => `Sign in to Settle\naccount: ${accountId}\ntimestamp: ${timestamp}`;
export const claimMessage = (contractId: string, publicKey: string, receiverId: string) => `settle-claim:${contractId}:${publicKey}:${receiverId}`;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};

export interface RelayResult {
  txHash: string;
  value: unknown;
  events: { event: string; data: any }[];
  failure: string | null;
  explorer_url: string | null;
}

export interface WalletConfig {
  contractId: string;
  rpcUrl: string;
  api: Settle;
}

export class SettleWallet {
  readonly account: Account;
  readonly provider: JsonRpcProvider;

  constructor(
    readonly accountId: string,
    readonly secretKey: KeyPairString,
    readonly cfg: WalletConfig,
  ) {
    this.provider = new JsonRpcProvider({ url: cfg.rpcUrl });
    this.account = new Account(accountId, this.provider, secretKey);
  }

  /** Create a brand-new named account (`<username>.<relayer>`) without the user ever touching NEAR. */
  static async create(username: string, cfg: WalletConfig): Promise<SettleWallet> {
    const kp = KeyPair.fromRandom("ed25519");
    const { account_id } = await cfg.api.public.createAccount({ username, public_key: kp.getPublicKey().toString() });
    const wallet = new SettleWallet(account_id, kp.toString(), cfg);
    // Wait until the account is visible to RPC.
    for (let i = 0; i < 20; i++) {
      if (await wallet.provider.viewAccount({ accountId: account_id }).then(() => true, () => false)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return wallet;
  }

  get publicKey() {
    return KeyPair.fromString(this.secretKey).getPublicKey().toString();
  }

  /** Sign-in with NEAR → session token for the dashboard API. */
  async login(): Promise<string> {
    const timestamp = Math.floor(Date.now() / 1000);
    const kp = KeyPair.fromString(this.secretKey);
    const { signature } = kp.sign(new TextEncoder().encode(loginMessage(this.accountId, timestamp)));
    const { token } = await this.cfg.api.public.login({ account_id: this.accountId, public_key: this.publicKey, timestamp, signature: b64(signature) });
    this.cfg.api.setToken(token);
    return token;
  }

  /** Sign a meta transaction and have the Settle relayer submit it. */
  async relay(receiverId: string, calls: { method: string; args: Record<string, unknown>; deposit?: bigint; tgas?: number }[]): Promise<RelayResult> {
    const { signedDelegate } = await this.account.createSignedMetaTransaction({
      receiverId,
      actions: calls.map((c) => actions.functionCall(c.method, c.args, teraToGas(c.tgas ?? 50), c.deposit ?? 0n)),
      blockHeightTtl: 120,
    });
    const res = await this.cfg.api.public.relay(b64(encodeSignedDelegate(signedDelegate)));
    if (res.failure) throw new Error(`Transaction failed: ${res.failure}`);
    return res;
  }

  private settle(method: string, args: Record<string, unknown>, deposit = 0n, tgas = 50) {
    return this.relay(this.cfg.contractId, [{ method, args, deposit, tgas }]);
  }

  view<T>(method: string, args: Record<string, unknown> = {}, contractId = this.cfg.contractId): Promise<T> {
    return this.provider.callFunction({ contractId, method, args }) as Promise<T>;
  }

  // ------------------------------------------------------------ business setup
  /** Register as a business and let the Settle API bill on your behalf (it can never move funds). */
  onboardBusiness(name: string, operatorId: string) {
    return this.relay(this.cfg.contractId, [
      { method: "register_business", args: { name }, tgas: 20 },
      { method: "add_operator", args: { operator: operatorId }, deposit: ONE_YOCTO, tgas: 20 },
    ]);
  }

  // ------------------------------------------------------------------ money in
  /** Move tokens from the wallet into the Settle treasury. */
  deposit(token: string, amount: bigint) {
    return this.relay(token, [
      { method: "ft_transfer_call", args: { receiver_id: this.cfg.contractId, amount: amount.toString(), msg: JSON.stringify({ action: "deposit" }) }, deposit: ONE_YOCTO, tgas: 100 },
    ]);
  }

  /** Pay an invoice straight from wallet tokens (excess is refunded by the token standard). */
  payInvoice(token: string, onchainId: number, amount: bigint) {
    return this.relay(token, [
      {
        method: "ft_transfer_call",
        args: { receiver_id: this.cfg.contractId, amount: amount.toString(), msg: JSON.stringify({ action: "pay_invoice", invoice_id: onchainId }) },
        deposit: ONE_YOCTO,
        tgas: 100,
      },
    ]);
  }

  payInvoiceFromBalance(onchainId: number) {
    return this.settle("pay_invoice_from_balance", { invoice_id: onchainId }, ONE_YOCTO);
  }

  subscribe(token: string, merchant: string, amountPerCycle: bigint, intervalSecs: number, prefund: bigint, reference?: string, maxCycles?: number) {
    return this.relay(token, [
      {
        method: "ft_transfer_call",
        args: {
          receiver_id: this.cfg.contractId,
          amount: prefund.toString(),
          msg: JSON.stringify({ action: "subscribe", merchant, amount: amountPerCycle.toString(), interval_secs: intervalSecs, max_cycles: maxCycles ?? null, reference: reference ?? null }),
        },
        deposit: ONE_YOCTO,
        tgas: 100,
      },
    ]);
  }

  cancelSubscription(id: number) {
    return this.settle("cancel_subscription", { subscription_id: id });
  }

  // ----------------------------------------------------------------- money out
  transfer(token: string, receiverId: string, amount: bigint, memo?: string) {
    return this.settle("transfer", { token, receiver_id: receiverId, amount: amount.toString(), memo: memo ?? null }, ONE_YOCTO);
  }

  /** Withdraw to any NEAR account. Pass `register` to storage-register the receiver with the token first. */
  withdraw(token: string, amount: bigint, receiverId?: string, register = true) {
    return this.settle("withdraw", { token, amount: amount.toString(), receiver_id: receiverId ?? null }, register ? STORAGE + ONE_YOCTO : ONE_YOCTO, 100);
  }

  runPayroll(token: string, entries: { account_id: string; amount: bigint }[], reference?: string) {
    return this.settle(
      "run_payroll",
      { token, entries: entries.map((e) => ({ account_id: e.account_id, amount: e.amount.toString() })), reference: reference ?? null },
      ONE_YOCTO,
      100,
    );
  }

  createStream(employee: string, token: string, total: bigint, durationSecs: number, memo?: string, startAt?: number) {
    return this.settle("create_stream", { employee, token, total: total.toString(), duration_secs: durationSecs, start_at: startAt ?? null, memo: memo ?? null }, ONE_YOCTO);
  }

  withdrawStream(streamId: number) {
    return this.settle("withdraw_stream", { stream_id: streamId });
  }

  cancelStream(streamId: number) {
    return this.settle("cancel_stream", { stream_id: streamId }, ONE_YOCTO);
  }

  createSplit(name: string, recipients: { account_id: string; bps: number }[]) {
    return this.settle("create_split", { name, recipients }, ONE_YOCTO);
  }

  // ----------------------------------------------------------------- AI agents
  setAgentPolicy(
    agentId: string,
    policy: { per_tx_limit: bigint; daily_limit: bigint; approval_threshold: bigint; allowed_recipients?: string[] | null; label: string; active?: boolean },
  ) {
    return this.settle(
      "set_agent_policy",
      {
        agent_id: agentId,
        policy: {
          per_tx_limit: policy.per_tx_limit.toString(),
          daily_limit: policy.daily_limit.toString(),
          approval_threshold: policy.approval_threshold.toString(),
          allowed_recipients: policy.allowed_recipients ?? null,
          label: policy.label,
          active: policy.active ?? true,
        },
      },
      ONE_YOCTO,
    );
  }

  approvePayment(approvalId: number) {
    return this.settle("approve_payment", { approval_id: approvalId }, ONE_YOCTO);
  }

  rejectPayment(approvalId: number) {
    return this.settle("reject_payment", { approval_id: approvalId });
  }

  // ---------------------------------------------------------------- claim links
  /**
   * Lock funds behind a one-time key. Returns the secret to embed in a link; whoever holds
   * it can claim to any account (gasless). The secret never touches the Settle servers
   * unless you ask the API to email it.
   */
  async createClaim(token: string, amount: bigint, memo?: string, expiresInSecs?: number) {
    const kp = KeyPair.fromRandom("ed25519");
    const publicKey = kp.getPublicKey().toString();
    const res = await this.settle(
      "create_claim",
      { public_key: publicKey, token, amount: amount.toString(), expires_in_secs: expiresInSecs ?? null, memo: memo ?? null },
      ONE_YOCTO,
    );
    return { publicKey, secret: kp.toString(), tx: res };
  }
}

/** Sign a claim with the link secret, binding it to `receiverId`. Returns hex signature. */
export function signClaim(secret: KeyPairString, contractId: string, receiverId: string) {
  const kp = KeyPair.fromString(secret);
  const publicKey = kp.getPublicKey().toString();
  const { signature } = kp.sign(new TextEncoder().encode(claimMessage(contractId, publicKey, receiverId)));
  return { publicKey, signature: hex(signature) };
}

export function claimUrl(webUrl: string, secret: string) {
  return `${webUrl.replace(/\/$/, "")}/claim#${secret.replace(/^ed25519:/, "")}`;
}

export function secretFromClaimUrlFragment(fragment: string): KeyPairString {
  return `ed25519:${fragment.replace(/^#/, "")}` as KeyPairString;
}
