import { config } from "./config.ts";
import { get, newId, now, parseJson, run, type Row } from "./db.ts";
import { call, fromBase, HttpError, relayer, tokenInfo, toBase, view } from "./near.ts";
import { emitEvent } from "./webhooks.ts";
import { customerKey, invoiceStatus, nextInvoiceNumber } from "./finance.ts";

export interface LineItem {
  description: string;
  quantity?: number;
  unit_amount?: string;
  amount: string;
}

export interface CreateInvoiceInput {
  business: string;
  kind: "invoice" | "checkout";
  amount?: string;
  line_items?: LineItem[];
  token?: string;
  description?: string;
  number?: string;
  customer_name?: string;
  customer_email?: string;
  due_at?: number;
  expires_in?: number;
  split_id?: number;
  success_url?: string;
  cancel_url?: string;
  metadata?: Record<string, string>;
}

/** Creates the invoice on-chain (the API is an *operator*: it can bill, never spend) and stores rich metadata off-chain. */
export async function createInvoice(input: CreateInvoiceInput) {
  const token = input.token ?? config.defaultTokenId;
  const info = await tokenInfo(token);
  const items = input.line_items ?? [];
  let base: bigint;
  if (input.amount) base = toBase(input.amount, info.decimals);
  else if (items.length) base = items.reduce((s, li) => s + toBase(li.amount, info.decimals), 0n);
  else throw new HttpError(400, "amount or line_items is required", "invalid_request");
  if (base <= 0n) throw new HttpError(400, "Amount must be positive", "invalid_amount");

  const isOperator = await view<boolean>("is_operator", { business: input.business, operator: config.relayerAccountId });
  if (!isOperator) {
    throw new HttpError(
      403,
      `Authorize Settle to bill on your behalf first: call add_operator("${config.relayerAccountId}") (Dashboard → Settings)`,
      "operator_required",
    );
  }

  const id = newId(input.kind === "checkout" ? "cs" : "inv");
  // Invoices always carry payment terms (default Net 30) so aging and "overdue" mean something.
  const dueAt = input.kind === "checkout" ? now() + (input.expires_in ?? 30 * 60) : (input.due_at ?? now() + 30 * 86400);
  const number = input.kind === "invoice" ? input.number || (await nextInvoiceNumber(input.business)) : input.number;
  const res = await call<number>(relayer(), "create_invoice", {
    business: input.business,
    kind: input.kind,
    token,
    amount: base.toString(),
    reference: id,
    due_at: dueAt ?? null,
    split_id: input.split_id ?? null,
  });
  const ts = now();
  await run(
    `INSERT INTO invoices (id, onchain_id, business, kind, token, amount, status, number, description, customer_name, customer_email,
      line_items, metadata, split_id, due_at, success_url, cancel_url, tx_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    res.value,
    input.business,
    input.kind,
    token,
    base.toString(),
    number ?? null,
    input.description ?? null,
    input.customer_name ?? null,
    input.customer_email ?? null,
    JSON.stringify(items),
    JSON.stringify(input.metadata ?? {}),
    input.split_id ?? null,
    dueAt ?? null,
    input.success_url ?? null,
    input.cancel_url ?? null,
    res.txHash,
    ts,
    ts,
  );
  const out = await serializeInvoice((await get("SELECT * FROM invoices WHERE id = ?", id))!);
  await emitEvent(input.business, "invoice.created", out);
  return out;
}

export async function serializeInvoice(r: Row) {
  const info = await tokenInfo(r.token);
  const business = await get("SELECT name FROM businesses WHERE account_id = ?", r.business);
  const isCheckout = r.kind === "checkout";
  return {
    id: r.id,
    object: isCheckout ? "checkout.session" : "invoice",
    onchain_id: r.onchain_id,
    business: r.business,
    business_name: business?.name ?? r.business,
    status: r.status,
    token: { id: r.token, symbol: info.symbol, decimals: info.decimals },
    amount: fromBase(r.amount, info.decimals),
    amount_paid: fromBase(r.amount_paid, info.decimals),
    amount_due: fromBase(BigInt(r.amount) - BigInt(r.amount_paid), info.decimals),
    amount_base: r.amount,
    number: r.number,
    description: r.description,
    customer_name: r.customer_name,
    customer_email: r.customer_email,
    line_items: parseJson(r.line_items, []),
    metadata: parseJson(r.metadata, {}),
    split_id: r.split_id,
    due_at: r.due_at,
    expires_at: isCheckout ? r.due_at : undefined,
    success_url: r.success_url,
    cancel_url: r.cancel_url,
    paid_at: r.paid_at,
    last_payer: r.last_payer,
    hosted_url: `${config.webUrl}/pay/${r.id}`,
    display_status: invoiceStatus(r).status,
    days_overdue: invoiceStatus(r).days_overdue,
    customer_key: customerKey(r),
    paid_via:
      await get("SELECT origin_asset, amount_in_formatted, mode, settle_tx FROM intent_deposits WHERE invoice_id = ? AND settled = 1 ORDER BY updated_at DESC LIMIT 1", r.id) ?? null,
    tx_hash: r.tx_hash,
    created_at: r.created_at,
  };
}

/** Pull the on-chain state of an invoice and emit events for changes. */
export async function syncInvoice(r: Row) {
  const chain = await view<any>("get_invoice", { invoice_id: r.onchain_id });
  if (!chain) return r;
  const status = chain.status as string;
  const paid = chain.amount_paid as string;
  if (status === r.status && paid === r.amount_paid) return r;
  await run(
    "UPDATE invoices SET status = ?, amount_paid = ?, paid_at = ?, last_payer = ?, updated_at = ? WHERE id = ?",
    status,
    paid,
    chain.paid_at ?? null,
    chain.last_payer ?? null,
    now(),
    r.id,
  );
  const updated = (await get("SELECT * FROM invoices WHERE id = ?", r.id))!;
  const data = await serializeInvoice(updated);
  if (status === "paid") {
    await emitEvent(r.business, r.kind === "checkout" ? "checkout.session.completed" : "invoice.paid", data);
  } else if (status === "cancelled") {
    await emitEvent(r.business, "invoice.cancelled", data);
  } else if (paid !== r.amount_paid) {
    await emitEvent(r.business, "invoice.partially_paid", data);
  }
  return updated;
}

export async function findInvoice(id: string, business?: string) {
  const r = await get("SELECT * FROM invoices WHERE id = ?", id);
  if (!r || (business && r.business !== business)) throw new HttpError(404, "No such invoice", "not_found");
  return r;
}
