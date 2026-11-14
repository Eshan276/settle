import { Hono } from "hono";
import { cors } from "hono/cors";
import { z, ZodError } from "zod";
import { extractBill } from "./ai.ts";
import { createApiKey, login, requireAuth, type AuthVars } from "./auth.ts";
import { config } from "./config.ts";
import { all, get, newId, now, parseJson, run } from "./db.ts";
import * as intents from "./intents.ts";
import { createInvoice, findInvoice, serializeInvoice, syncInvoice } from "./invoices.ts";
import {
  acceptedTokens,
  agent,
  call,
  decodeSignedDelegate,
  explorerTx,
  fromBase,
  HttpError,
  provider,
  relayer,
  relaySignedDelegate,
  settleEvents,
  tokenInfo,
  toBase,
  validateDelegate,
  view,
} from "./near.ts";
import { advanceDeposit, runAllJobs, settleDeposit, syncBusinessSoon } from "./watcher.ts";
import { background } from "./background.ts";
import { emitEvent, eventById, newWebhookSecret } from "./webhooks.ts";
import { ledgerFor } from "./ledger.ts";
import { registerFinance } from "./routes-finance.ts";

export const app = new Hono<AuthVars>();

app.use("*", cors({ origin: (o) => o ?? "*", allowHeaders: ["authorization", "content-type"], allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: { type: err.code, message: err.message } }, err.status as any);
  if (err instanceof ZodError) {
    return c.json({ error: { type: "invalid_request", message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } }, 400);
  }
  if (err instanceof SyntaxError) return c.json({ error: { type: "invalid_request", message: "Body must be valid JSON" } }, 400);
  const cause = (err as any)?.cause;
  if ((err instanceof TypeError && /fetch failed/.test(err.message) && cause) || /Exceeded \d+ providers|ETIMEDOUT|ECONNRESET|-429|\b429\b/.test(err.message)) {
    console.warn("[settle] upstream network error:", cause?.code ?? cause?.message ?? err.message.slice(0, 120));
    return c.json({ error: { type: "network_unavailable", message: "The NEAR network is briefly unreachable. Please retry in a moment." } }, 503);
  }
  console.error("[settle] unhandled", err);
  return c.json({ error: { type: "api_error", message: (err as Error).message ?? "Internal error" } }, 500);
});

const body = async <T extends z.ZodType>(c: { req: { json: () => Promise<unknown> } }, schema: T): Promise<z.infer<T>> =>
  schema.parse(await c.req.json().catch(() => ({})));

// Rate limiter for the sponsored (gas-costing) public endpoints, kept in Postgres so every instance shares it.
async function rateLimit(key: string, max: number, windowSecs: number) {
  const t = now();
  const n = (await get("SELECT COUNT(*) AS n FROM rate_hits WHERE key = ? AND at > ?", key, t - windowSecs))!.n as number;
  if (n >= max) throw new HttpError(429, "Too many requests, slow down", "rate_limited");
  await run("INSERT INTO rate_hits (key, at) VALUES (?, ?)", key, t);
  if (Math.random() < 0.02) await run("DELETE FROM rate_hits WHERE at < ?", t - 86400);
}
const ip = (c: any) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

const accountIdSchema = z.string().regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/, "invalid NEAR account id").min(2).max(64);
const amountSchema = z.union([z.string(), z.number()]).transform(String);

// ============================================================ public / platform

app.get("/health", (c) => c.json({ ok: true }));

/** Runs every sync job once (Vercel cron, or any pinger). Protected by CRON_SECRET when it is set. */
app.get("/v1/cron/tick", async (c) => {
  const secret = process.env.CRON_SECRET;
  if (secret && c.req.header("authorization") !== `Bearer ${secret}`) throw new HttpError(401, "Bad cron secret", "auth_invalid");
  return c.json(await runAllJobs());
});

app.get("/v1/config", async (c) => {
  const tokens = config.contractId ? await acceptedTokens().catch(() => [config.defaultTokenId]) : [];
  return c.json({
    network: config.network,
    rpc_url: config.rpcUrl,
    explorer_url: config.explorerUrl,
    contract_id: config.contractId,
    relayer_account_id: config.relayerAccountId,
    agent_account_id: config.agentAccountId,
    default_token: config.defaultTokenId ? await tokenInfo(config.defaultTokenId) : null,
    tokens: await Promise.all(tokens.map(tokenInfo)),
    intents_mode: config.intentsMode,
    ai_enabled: config.aiEnabled,
    account_suffix: config.relayerAccountId,
  });
});

app.post("/v1/auth/login", async (c) => {
  const b = await body(c, z.object({ account_id: accountIdSchema, public_key: z.string(), timestamp: z.number(), signature: z.string() }));
  return c.json(await login(b.account_id, b.public_key, b.timestamp, b.signature));
});

/** Gasless onboarding: create `<username>.<relayer>` owned by the caller's public key. */
app.post("/v1/accounts", async (c) => {
  const b = await body(c, z.object({ username: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,30}$/), public_key: z.string().startsWith("ed25519:") }));
  await rateLimit(`acct:${ip(c)}`, Number(process.env.ACCOUNTS_PER_IP_PER_HOUR ?? 10), 3600);
  const accountId = `${b.username}.${config.relayerAccountId}`;
  const exists = await provider.viewAccount({ accountId }).then(() => true, () => false);
  if (exists) throw new HttpError(409, `${accountId} is taken`, "account_exists");
  const nearToTransfer = BigInt(Math.round(Number(config.newAccountNear) * 1e6)) * 10n ** 18n;
  const res = await relayer().createSubAccount({ accountOrPrefix: b.username, publicKey: b.public_key, nearToTransfer });
  return c.json({ account_id: accountId, tx_hash: (res as any).transaction?.hash ?? null });
});

/** Meta-transaction relayer (NEP-366). The user signs, Settle pays gas. */
app.post("/v1/relay", async (c) => {
  const b = await body(c, z.object({ signed_delegate: z.string() }));
  const sd = decodeSignedDelegate(b.signed_delegate);
  await rateLimit(`relay:${sd.delegateAction.senderId}`, 30, 60);
  await validateDelegate(sd, await acceptedTokens());
  const out = await relaySignedDelegate(sd);
  // Fast-path state sync so hosted pages flip to "paid" immediately.
  for (const e of out.events) {
    if (e.event === "invoice_paid" || e.event === "invoice_partially_paid") {
      const inv = await get("SELECT * FROM invoices WHERE onchain_id = ?", e.data.invoice_id);
      if (inv) await syncInvoice(inv).catch(() => undefined);
    }
  }
  return c.json({ ...out, explorer_url: out.txHash ? explorerTx(out.txHash) : null }, out.failure ? 422 : 200);
});

/** Testnet faucet for the demo stablecoin (sUSD). */
app.post("/v1/faucet", async (c) => {
  if (config.network !== "testnet") throw new HttpError(404, "Faucet is testnet-only", "not_found");
  const b = await body(c, z.object({ account_id: accountIdSchema, amount: amountSchema.optional() }));
  await rateLimit(`faucet:${b.account_id}`, 5, 86400);
  const info = await tokenInfo(config.defaultTokenId);
  const amount = toBase(b.amount ?? "1000", info.decimals);
  const res = await call(relayer(), "mint", { account_id: b.account_id, amount: amount.toString() }, { contractId: config.defaultTokenId, tgas: 30 });
  return c.json({ ok: true, amount: fromBase(amount, info.decimals), token: info.symbol, tx_hash: res.txHash });
});

app.get("/v1/public/invoices/:id", async (c) => {
  let r = await findInvoice(c.req.param("id"));
  if (r.status === "open") r = await syncInvoice(r).catch(() => r);
  const inv = await serializeInvoice(r);
  const { metadata: _m, ...publicFields } = inv;
  return c.json({ ...publicFields, contract_id: config.contractId, intents_mode: config.intentsMode });
});

app.get("/v1/intents/tokens", async (c) => c.json({ mode: config.intentsMode, tokens: await intents.listTokens() }));

/** Pay from any chain: get a NEAR Intents deposit address that settles exactly the amount due. */
app.post("/v1/public/invoices/:id/intent-quote", async (c) => {
  const b = await body(c, z.object({ origin_asset: z.string(), refund_to: z.string().min(2) }));
  await rateLimit(`quote:${ip(c)}`, 30, 600);
  const r = await findInvoice(c.req.param("id"));
  if (r.status !== "open") throw new HttpError(409, "Invoice is not open", "invoice_not_open");
  const info = await tokenInfo(r.token);
  const due = BigInt(r.amount) - BigInt(r.amount_paid);
  const q = await intents.quote({
    originAsset: b.origin_asset,
    destinationTokenId: r.token,
    amountOut: due,
    destinationDecimals: info.decimals,
    refundTo: b.refund_to,
    recipient: config.relayerAccountId,
  });
  const ts = now();
  await run(
    `INSERT INTO intent_deposits (deposit_address, invoice_id, mode, origin_asset, amount_in, amount_in_formatted, amount_out, refund_to, status, quote, deadline, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_DEPOSIT', ?, ?, ?, ?)`,
    q.depositAddress,
    r.id,
    config.intentsMode,
    b.origin_asset,
    q.amountIn,
    q.amountInFormatted,
    q.amountOut,
    b.refund_to,
    JSON.stringify(q.raw),
    q.deadline,
    ts,
    ts,
  );
  const token = (await intents.listTokens()).find((t) => t.assetId === b.origin_asset);
  return c.json({
    deposit_address: q.depositAddress,
    origin_asset: b.origin_asset,
    origin_symbol: token?.symbol,
    origin_chain: token?.blockchain,
    amount_in: q.amountIn,
    amount_in_formatted: q.amountInFormatted,
    amount_out_formatted: q.amountOutFormatted,
    deadline: q.deadline,
    time_estimate_secs: q.timeEstimate,
    mode: config.intentsMode,
  });
});

app.get("/v1/public/intent-deposits/:address", async (c) => {
  const d = await get("SELECT * FROM intent_deposits WHERE deposit_address = ?", c.req.param("address"));
  if (!d) throw new HttpError(404, "Unknown deposit address", "not_found");
  // No background poller in production: the pay page's status polling drives the deposit forward.
  if (!d.settled) background("deposit advance", () => advanceDeposit(d));
  const inv = await get("SELECT status FROM invoices WHERE id = ?", d.invoice_id);
  return c.json({
    deposit_address: d.deposit_address,
    status: d.status,
    settled: Boolean(d.settled),
    settle_tx: d.settle_tx,
    settle_explorer_url: d.settle_tx ? explorerTx(d.settle_tx) : null,
    invoice_status: inv?.status,
    mode: d.mode,
  });
});

/** Customer tells us they've sent the deposit (speeds up 1Click detection; drives the simulator on testnet). */
app.post("/v1/public/intent-deposits/:address/sent", async (c) => {
  const b = await body(c, z.object({ tx_hash: z.string().optional() }));
  const d = await get("SELECT * FROM intent_deposits WHERE deposit_address = ?", c.req.param("address"));
  if (!d) throw new HttpError(404, "Unknown deposit address", "not_found");
  if (d.mode === "simulated") {
    if (d.status === "PENDING_DEPOSIT") await run("UPDATE intent_deposits SET status = 'KNOWN_DEPOSIT_TX', updated_at = ? WHERE deposit_address = ?", now(), d.deposit_address);
  } else if (b.tx_hash) {
    await intents.submitDepositTx(d.deposit_address, b.tx_hash);
  }
  return c.json({ ok: true });
});

app.get("/v1/public/claims/:public_key", async (c) => {
  const pk = c.req.param("public_key");
  const claim = await view<any>("get_claim", { public_key: pk });
  const rec = await get("SELECT * FROM email_payouts WHERE public_key = ?", pk);
  if (!claim && !rec) throw new HttpError(404, "Unknown claim", "not_found");
  const info = await tokenInfo(claim?.token ?? rec!.token);
  const creator = claim?.creator ?? rec?.account_id;
  const biz = await get("SELECT name FROM businesses WHERE account_id = ?", creator);
  return c.json({
    public_key: pk,
    status: claim ? "unclaimed" : rec?.status === "claimed" ? "claimed" : "unavailable",
    amount: fromBase(claim?.amount ?? toBase(rec!.amount, info.decimals), info.decimals),
    token: info,
    from: biz?.name ?? creator,
    from_account: creator,
    memo: claim?.memo ?? rec?.memo,
    recipient_name: rec?.recipient_name,
    claimed_by: rec?.claimed_by,
    expires_at: claim?.expires_at ?? null,
    contract_id: config.contractId,
  });
});

/** Gasless claim: the recipient signs with the link's one-time key; Settle submits. */
app.post("/v1/claims/redeem", async (c) => {
  const b = await body(c, z.object({ public_key: z.string(), receiver_id: accountIdSchema, signature: z.string().regex(/^[0-9a-f]{128}$/i) }));
  await rateLimit(`claim:${ip(c)}`, 20, 600);
  const res = await call<string>(relayer(), "claim", { public_key: b.public_key, receiver_id: b.receiver_id, signature: b.signature }, { tgas: 30 });
  const rec = await get("SELECT * FROM email_payouts WHERE public_key = ?", b.public_key);
  if (rec) {
    await run("UPDATE email_payouts SET status = 'claimed', claimed_by = ?, updated_at = ? WHERE public_key = ?", b.receiver_id, now(), b.public_key);
    await emitEvent(rec.account_id, "payout.email.claimed", { public_key: b.public_key, receiver_id: b.receiver_id, amount: rec.amount, tx_hash: res.txHash });
  }
  return c.json({ ok: true, receiver_id: b.receiver_id, tx_hash: res.txHash, explorer_url: explorerTx(res.txHash) });
});

// ===================================================================== private

const v1 = new Hono<AuthVars>();
v1.use("*", requireAuth);

v1.get("/me", async (c) => {
  const accountId = c.get("accountId");
  const [business, operator, balances, agentPolicy] = await Promise.all([
    view<any>("get_business", { account_id: accountId }),
    view<boolean>("is_operator", { business: accountId, operator: config.relayerAccountId }),
    view<[string, string][]>("get_balances", { account_id: accountId }),
    view<any>("get_agent_policy", { business: accountId, agent_id: config.agentAccountId }),
  ]);
  const local = await get("SELECT * FROM businesses WHERE account_id = ?", accountId);
  return c.json({
    account_id: accountId,
    business: business ? { ...business, email: local?.email ?? null } : null,
    settle_is_operator: operator,
    ai_agent_policy: agentPolicy,
    balances: await Promise.all(
      balances.map(async ([token, amount]) => {
        const info = await tokenInfo(token);
        return { token: info, amount: fromBase(amount, info.decimals), amount_base: amount };
      }),
    ),
  });
});

/** Sync the off-chain profile after the dashboard registers the business on-chain. */
v1.post("/businesses", async (c) => {
  const b = await body(c, z.object({ name: z.string().min(1).max(64), email: z.string().email().optional() }));
  const accountId = c.get("accountId");
  await run(
    "INSERT INTO businesses (account_id, name, email, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET name = excluded.name, email = COALESCE(excluded.email, businesses.email)",
    accountId,
    b.name,
    b.email ?? null,
    now(),
  );
  return c.json(await get("SELECT * FROM businesses WHERE account_id = ?", accountId));
});

// ------------------------------------------------------------------ api keys
v1.post("/api_keys", async (c) => {
  if (c.get("authKind") !== "session") throw new HttpError(403, "API keys can only be created from the dashboard", "forbidden");
  const b = await body(c, z.object({ name: z.string().max(64).optional() }));
  return c.json(await createApiKey(c.get("accountId"), b.name));
});
v1.get("/api_keys", async (c) =>
  c.json({
    data: await all("SELECT id, prefix, name, created_at, last_used_at FROM api_keys WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at DESC", c.get("accountId")),
  }),
);
v1.delete("/api_keys/:id", async (c) => {
  await run("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND account_id = ?", now(), c.req.param("id"), c.get("accountId"));
  return c.json({ id: c.req.param("id"), deleted: true });
});

// ------------------------------------------------------------------ invoices
const lineItemSchema = z.object({ description: z.string().max(200), quantity: z.number().optional(), unit_amount: amountSchema.optional(), amount: amountSchema });
const invoiceSchema = z.object({
  amount: amountSchema.optional(),
  line_items: z.array(lineItemSchema).max(50).optional(),
  token: z.string().optional(),
  description: z.string().max(500).optional(),
  number: z.string().max(64).optional(),
  customer_name: z.string().max(120).optional(),
  customer_email: z.string().email().optional(),
  due_at: z.number().int().optional(),
  split_id: z.number().int().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

v1.post("/invoices", async (c) => {
  const b = await body(c, invoiceSchema.extend({ send: z.boolean().optional() }));
  const inv = await createInvoice({ ...b, kind: "invoice", business: c.get("accountId") });
  if (b.send && inv.customer_email) await sendInvoiceEmail(inv);
  return c.json(inv);
});

v1.post("/invoices/:id/send", async (c) => {
  const r = await findInvoice(c.req.param("id"), c.get("accountId"));
  if (!r.customer_email) throw new HttpError(400, "Invoice has no customer email", "invalid_request");
  await sendInvoiceEmail(await serializeInvoice(r));
  return c.json({ ok: true, sent_to: r.customer_email });
});

async function sendInvoiceEmail(inv: any) {
  const due = inv.due_at ? `, due ${new Date(inv.due_at * 1000).toDateString()}` : "";
  const subject = `Invoice ${inv.number ?? inv.id} from ${inv.business_name}: $${inv.amount_due} due`;
  const text = [`${inv.business_name} sent you invoice ${inv.number ?? inv.id} for $${inv.amount_due}${due}.`, "", `Pay online from any chain or token: ${inv.hosted_url}`].join("\n");
  await deliverEmail(inv.customer_email, subject, text);
}

v1.post("/checkout/sessions", async (c) => {
  const b = await body(
    c,
    invoiceSchema.extend({ success_url: z.string().url().optional(), cancel_url: z.string().url().optional(), expires_in: z.number().int().min(60).max(86400).optional() }),
  );
  return c.json(await createInvoice({ ...b, kind: "checkout", business: c.get("accountId") }));
});

const listInvoices = (kind: string) => async (c: any) => {
  const status = c.req.query("status");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);
  await syncBusinessSoon(c.get("accountId"));
  const rows = status
    ? await all("SELECT * FROM invoices WHERE business = ? AND kind = ? AND status = ? ORDER BY created_at DESC LIMIT ?", c.get("accountId"), kind, status, limit)
    : await all("SELECT * FROM invoices WHERE business = ? AND kind = ? ORDER BY created_at DESC LIMIT ?", c.get("accountId"), kind, limit);
  return c.json({ object: "list", data: await Promise.all(rows.map(serializeInvoice)) });
};
v1.get("/invoices", listInvoices("invoice"));
v1.get("/checkout/sessions", listInvoices("checkout"));

v1.get("/invoices/:id", async (c) => c.json(await serializeInvoice(await syncInvoice(await findInvoice(c.req.param("id"), c.get("accountId"))))));
v1.get("/checkout/sessions/:id", async (c) => c.json(await serializeInvoice(await syncInvoice(await findInvoice(c.req.param("id"), c.get("accountId"))))));

v1.post("/invoices/:id/cancel", async (c) => {
  const r = await findInvoice(c.req.param("id"), c.get("accountId"));
  await call(relayer(), "cancel_invoice", { invoice_id: r.onchain_id }, { tgas: 20 });
  return c.json(await serializeInvoice(await syncInvoice(r)));
});

// -------------------------------------------------------------- email payouts
v1.post("/payouts/email", async (c) => {
  const b = await body(
    c,
    z.object({ public_key: z.string(), recipient_email: z.string().email().optional(), recipient_name: z.string().max(120).optional(), claim_url: z.string().url().optional() }),
  );
  const accountId = c.get("accountId");
  const claim = await view<any>("get_claim", { public_key: b.public_key });
  if (!claim || claim.creator !== accountId) throw new HttpError(404, "Create the claim on-chain first (create_claim)", "claim_not_found");
  const info = await tokenInfo(claim.token);
  await run(
    `INSERT INTO email_payouts (public_key, account_id, recipient_email, recipient_name, token, amount, memo, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?) ON CONFLICT(public_key) DO NOTHING`,
    b.public_key,
    accountId,
    b.recipient_email ?? null,
    b.recipient_name ?? null,
    claim.token,
    fromBase(claim.amount, info.decimals),
    claim.memo,
    now(),
    now(),
  );
  if (b.recipient_email && b.claim_url) await sendEmail(b.recipient_email, accountId, fromBase(claim.amount, info.decimals), info.symbol, b.claim_url, claim.memo);
  await emitEvent(accountId, "payout.email.created", { public_key: b.public_key, recipient_email: b.recipient_email, amount: fromBase(claim.amount, info.decimals) });
  return c.json({ ok: true, emailed: Boolean(b.recipient_email && b.claim_url) });
});

v1.get("/payouts/email", async (c) => c.json({ data: await all("SELECT * FROM email_payouts WHERE account_id = ? ORDER BY created_at DESC LIMIT 100", c.get("accountId")) }));

async function sendEmail(to: string, from: string, amount: string, symbol: string, url: string, memo: string) {
  const biz = (await get("SELECT name FROM businesses WHERE account_id = ?", from))?.name ?? from;
  const subject = `${biz} sent you ${amount} ${symbol}`;
  const text = `${biz} sent you ${amount} ${symbol}${memo ? ` — "${memo}"` : ""}.\n\nClaim it here (no crypto wallet needed): ${url}\n\nPowered by Settle`;
  await deliverEmail(to, subject, text);
}

/** Resend if configured, otherwise log to the console (dev). */
async function deliverEmail(to: string, subject: string, text: string) {
  if (process.env.RESEND_API_KEY) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "Settle <payouts@resend.dev>", to, subject, text }),
    }).catch((e) => console.error("[settle] email failed", e.message));
  } else {
    console.log(`\n[settle:email] to=${to}\n  subject: ${subject}\n  ${text.replace(/\n/g, "\n  ")}\n`);
  }
}

// ---------------------------------------------------------- AI accounts payable
const serializeBill = (r: any) => ({ ...r, line_items: parseJson(r.line_items, []), risk_flags: parseJson(r.risk_flags, []) });

v1.post("/bills/parse", async (c) => {
  const b = await body(c, z.object({ text: z.string().max(50_000).optional(), file_base64: z.string().optional(), media_type: z.string().optional() }));
  const accountId = c.get("accountId");
  const bill = await extractBill({ text: b.text, fileBase64: b.file_base64, mediaType: b.media_type });
  const flags = [...bill.risk_flags];
  if (bill.invoice_number) {
    const dup = await get("SELECT id FROM bills WHERE account_id = ? AND invoice_number = ? AND vendor_name = ? AND status = 'paid'", accountId, bill.invoice_number, bill.vendor_name);
    if (dup) flags.push(`duplicate of already-paid bill ${dup.id}`);
  }
  if (!bill.vendor_near_account) flags.push("no NEAR payment account on bill");
  if (bill.due_date && bill.due_date < new Date().toISOString().slice(0, 10)) flags.push("due date in the past");
  const status = flags.length || bill.confidence < 0.7 ? "needs_review" : "ready";
  const id = newId("bill");
  await run(
    `INSERT INTO bills (id, account_id, vendor_name, vendor_account, vendor_email, invoice_number, amount, currency, due_date, description, line_items, confidence, risk_flags, source, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    accountId,
    bill.vendor_name,
    bill.vendor_near_account,
    bill.vendor_email,
    bill.invoice_number,
    bill.total_amount,
    bill.currency,
    bill.due_date,
    bill.description,
    JSON.stringify(bill.line_items),
    bill.confidence,
    JSON.stringify(flags),
    bill.parser,
    status,
    now(),
    now(),
  );
  const out = serializeBill(await get("SELECT * FROM bills WHERE id = ?", id));
  await emitEvent(accountId, "bill.parsed", out);
  return c.json(out);
});

v1.get("/bills", async (c) => {
  const accountId = c.get("accountId");
  // Reflect human decisions made on-chain (approve/reject) back onto bills.
  for (const bill of await all("SELECT * FROM bills WHERE account_id = ? AND status = 'pending_approval' AND approval_id IS NOT NULL", accountId)) {
    const a = await view<any>("get_approval", { approval_id: bill.approval_id }).catch(() => null);
    if (a && a.status !== "pending") await run("UPDATE bills SET status = ?, updated_at = ? WHERE id = ?", a.status === "approved" ? "paid" : "rejected", now(), bill.id);
  }
  return c.json({ data: (await all("SELECT * FROM bills WHERE account_id = ? ORDER BY created_at DESC LIMIT 100", accountId)).map(serializeBill) });
});

/** Ask the AI agent to pay a bill. The contract enforces the business' AgentPolicy. */
v1.post("/bills/:id/pay", async (c) => {
  const b = await body(c, z.object({ vendor_account: accountIdSchema.optional(), override_review: z.boolean().optional() }));
  const accountId = c.get("accountId");
  const bill = await get("SELECT * FROM bills WHERE id = ? AND account_id = ?", c.req.param("id"), accountId);
  if (!bill) throw new HttpError(404, "No such bill", "not_found");
  if (!["ready", "needs_review"].includes(bill.status)) throw new HttpError(409, `Bill is ${bill.status}`, "bill_not_payable");
  if (bill.status === "needs_review" && !(b.override_review && c.get("authKind") === "session")) {
    throw new HttpError(409, "Bill needs human review (risk flags or low confidence). Review it in the dashboard.", "bill_needs_review");
  }
  const recipient = b.vendor_account ?? bill.vendor_account;
  if (!recipient) throw new HttpError(400, "Vendor NEAR account is unknown; provide vendor_account", "invalid_request");
  const token = config.defaultTokenId;
  const info = await tokenInfo(token);
  const amount = toBase(bill.amount, info.decimals);
  const res = await call<{ status: string; approval_id: number | null; reasons: string[] }>(
    agent(),
    "agent_pay",
    { business: accountId, token, recipient, amount: amount.toString(), memo: `${bill.vendor_name} ${bill.invoice_number ?? ""}`.trim() },
    { tgas: 50 },
  );
  const paid = res.value.status === "paid";
  await run(
    "UPDATE bills SET status = ?, approval_id = ?, vendor_account = ?, tx_hash = ?, updated_at = ? WHERE id = ?",
    paid ? "paid" : "pending_approval",
    res.value.approval_id,
    recipient,
    res.txHash,
    now(),
    bill.id,
  );
  const out = { ...serializeBill(await get("SELECT * FROM bills WHERE id = ?", bill.id)), agent_result: res.value, explorer_url: explorerTx(res.txHash) };
  await emitEvent(accountId, paid ? "bill.paid" : "bill.pending_approval", out);
  return c.json(out);
});

// -------------------------------------------------------------------- webhooks
v1.post("/webhook_endpoints", async (c) => {
  const b = await body(c, z.object({ url: z.string().url(), events: z.array(z.string()).optional() }));
  const id = newId("we", 14);
  const secret = newWebhookSecret();
  await run("INSERT INTO webhook_endpoints (id, account_id, url, secret, events, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, c.get("accountId"), b.url, secret, JSON.stringify(b.events ?? ["*"]), now());
  return c.json({ id, url: b.url, events: b.events ?? ["*"], secret });
});
v1.get("/webhook_endpoints", async (c) =>
  c.json({
    data: (await all("SELECT id, url, events, created_at FROM webhook_endpoints WHERE account_id = ? AND disabled_at IS NULL", c.get("accountId"))).map((r) => ({ ...r, events: parseJson(r.events, ["*"]) })),
  }),
);
v1.delete("/webhook_endpoints/:id", async (c) => {
  await run("UPDATE webhook_endpoints SET disabled_at = ? WHERE id = ? AND account_id = ?", now(), c.req.param("id"), c.get("accountId"));
  return c.json({ id: c.req.param("id"), deleted: true });
});

v1.get("/events", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 30), 100);
  const rows = await all("SELECT id FROM events WHERE account_id = ? ORDER BY created_at DESC, seq DESC LIMIT ?", c.get("accountId"), limit);
  return c.json({ object: "list", data: await Promise.all(rows.map((r) => eventById(r.id))) });
});
v1.get("/events/:id", async (c) => {
  const e = await get("SELECT account_id FROM events WHERE id = ?", c.req.param("id"));
  if (!e || e.account_id !== c.get("accountId")) throw new HttpError(404, "No such event", "not_found");
  return c.json(await eventById(c.req.param("id")));
});

// ---------------------------------------------------------------------- ledger
/** Every on-chain Settle event touching this account, newest first, with tx proof. */
v1.get("/ledger", async (c) => {
  const events = c.req.query("events")?.split(",").filter(Boolean);
  return c.json({ object: "list", data: await ledgerFor(c.get("accountId"), { events, limit: Number(c.req.query("limit") ?? 200), since: Number(c.req.query("since") ?? 0) }) });
});

// --------------------------------------------------------------- dev helpers
/** Manually trigger settlement of a delivered intent deposit (ops tool). */
v1.post("/intent-deposits/:address/settle", async (c) => {
  const d = await get("SELECT d.* FROM intent_deposits d JOIN invoices i ON i.id = d.invoice_id WHERE d.deposit_address = ? AND i.business = ?", c.req.param("address"), c.get("accountId"));
  if (!d) throw new HttpError(404, "Unknown deposit", "not_found");
  await settleDeposit(d);
  return c.json(await get("SELECT * FROM intent_deposits WHERE deposit_address = ?", d.deposit_address));
});

registerFinance(v1);
app.route("/v1", v1);

export { settleEvents };
