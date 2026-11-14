/** Stripe-style REST client for the Settle API. Works in Node and the browser. */
export class SettleError extends Error {
  constructor(public status: number, public type: string, message: string) {
    super(message);
  }
}

export interface SettleOptions {
  baseUrl?: string;
}

type Json = Record<string, unknown>;

export class Settle {
  readonly baseUrl: string;
  constructor(private token?: string, opts: SettleOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "http://localhost:4000").replace(/\/$/, "");
  }

  setToken(token: string) {
    this.token = token;
  }

  async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new SettleError(res.status, json?.error?.type ?? "api_error", json?.error?.message ?? `HTTP ${res.status}`);
    return json as T;
  }

  config = () => this.request("GET", "/v1/config");
  me = () => this.request("GET", "/v1/me");

  invoices = {
    create: (p: Json) => this.request("POST", "/v1/invoices", p),
    list: (q: { status?: string; limit?: number } = {}) => this.request("GET", `/v1/invoices${qs(q)}`),
    retrieve: (id: string) => this.request("GET", `/v1/invoices/${id}`),
    cancel: (id: string) => this.request("POST", `/v1/invoices/${id}/cancel`, {}),
  };

  checkout = {
    sessions: {
      create: (p: Json) => this.request("POST", "/v1/checkout/sessions", p),
      list: (q: { status?: string; limit?: number } = {}) => this.request("GET", `/v1/checkout/sessions${qs(q)}`),
      retrieve: (id: string) => this.request("GET", `/v1/checkout/sessions/${id}`),
    },
  };

  bills = {
    parse: (p: { text?: string; file_base64?: string; media_type?: string }) => this.request("POST", "/v1/bills/parse", p),
    list: () => this.request("GET", "/v1/bills"),
    pay: (id: string, p: { vendor_account?: string; override_review?: boolean } = {}) => this.request("POST", `/v1/bills/${id}/pay`, p),
  };

  payouts = {
    email: {
      create: (p: { public_key: string; recipient_email?: string; recipient_name?: string; claim_url?: string }) =>
        this.request("POST", "/v1/payouts/email", p),
      list: () => this.request("GET", "/v1/payouts/email"),
    },
  };

  webhookEndpoints = {
    create: (p: { url: string; events?: string[] }) => this.request("POST", "/v1/webhook_endpoints", p),
    list: () => this.request("GET", "/v1/webhook_endpoints"),
    del: (id: string) => this.request("DELETE", `/v1/webhook_endpoints/${id}`),
  };

  events = {
    list: (q: { limit?: number } = {}) => this.request("GET", `/v1/events${qs(q)}`),
    retrieve: (id: string) => this.request("GET", `/v1/events/${id}`),
  };

  apiKeys = {
    create: (name?: string) => this.request("POST", "/v1/api_keys", { name }),
    list: () => this.request("GET", "/v1/api_keys"),
    del: (id: string) => this.request("DELETE", `/v1/api_keys/${id}`),
  };

  /** Public endpoints used by hosted pages (no auth). */
  public = {
    invoice: (id: string) => this.request("GET", `/v1/public/invoices/${id}`),
    intentTokens: () => this.request("GET", "/v1/intents/tokens"),
    intentQuote: (invoiceId: string, p: { origin_asset: string; refund_to: string }) =>
      this.request("POST", `/v1/public/invoices/${invoiceId}/intent-quote`, p),
    intentDeposit: (address: string) => this.request("GET", `/v1/public/intent-deposits/${address}`),
    intentDepositSent: (address: string, txHash?: string) => this.request("POST", `/v1/public/intent-deposits/${address}/sent`, { tx_hash: txHash }),
    claim: (publicKey: string) => this.request("GET", `/v1/public/claims/${encodeURIComponent(publicKey)}`),
    redeemClaim: (p: { public_key: string; receiver_id: string; signature: string }) => this.request("POST", "/v1/claims/redeem", p),
    createAccount: (p: { username: string; public_key: string }) => this.request("POST", "/v1/accounts", p),
    faucet: (accountId: string, amount?: string) => this.request("POST", "/v1/faucet", { account_id: accountId, amount }),
    relay: (signedDelegateB64: string) => this.request("POST", "/v1/relay", { signed_delegate: signedDelegateB64 }),
    login: (p: { account_id: string; public_key: string; timestamp: number; signature: string }) => this.request("POST", "/v1/auth/login", p),
  };
}

function qs(q: Record<string, unknown>) {
  const p = Object.entries(q).filter(([, v]) => v !== undefined);
  return p.length ? `?${new URLSearchParams(p.map(([k, v]) => [k, String(v)]))}` : "";
}
