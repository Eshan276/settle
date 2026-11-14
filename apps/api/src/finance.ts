/**
 * Finance layer: turns raw on-chain events (ledger) + off-chain metadata (invoices, bills,
 * people) into the objects a finance team works with: money movements, customers,
 * pay runs, aging, summaries and CSV reports.
 */
import { config } from "./config.ts";
import { all, get, now, parseJson, type Row } from "./db.ts";
import { ledgerFor } from "./ledger.ts";
import { fromBase, tokenInfo, view } from "./near.ts";

const DAY = 86400;

// ------------------------------------------------------------------ helpers
let feeCache: { at: number; bps: number } | undefined;
export async function feeBps() {
  if (feeCache && Date.now() - feeCache.at < 300_000) return feeCache.bps;
  const cfg = await view<{ fee_bps: number }>("get_config").catch(() => ({ fee_bps: 0 }));
  feeCache = { at: Date.now(), bps: cfg.fee_bps };
  return cfg.fee_bps;
}
const splitCache = new Map<number, { account_id: string; bps: number }[]>();
async function splitRecipients(id: number | null | undefined) {
  if (id == null) return [];
  if (!splitCache.has(id)) splitCache.set(id, ((await view<any>("get_split", { split_id: id }).catch(() => null))?.recipients ?? []) as any);
  return splitCache.get(id)!;
}
async function dec() {
  return (await tokenInfo(config.defaultTokenId)).decimals;
}
export const usd = (base: bigint | string, d: number) => fromBase(BigInt(base) < 0n ? -BigInt(base) : BigInt(base), d);

export function csv(rows: Record<string, unknown>[], columns?: string[]) {
  const cols = columns ?? Object.keys(rows[0] ?? {});
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

async function nameIndex(me: string) {
  const names = new Map<string, string>();
  for (const p of await all("SELECT name, near_account FROM people WHERE account_id = ?", me)) if (p.near_account) names.set(p.near_account, p.name);
  for (const b of await all("SELECT vendor_name, vendor_account FROM bills WHERE account_id = ? AND vendor_account IS NOT NULL", me)) names.set(b.vendor_account, b.vendor_name);
  for (const b of await all("SELECT account_id, name FROM businesses")) names.set(b.account_id, b.name);
  return names;
}

// ---------------------------------------------------------- invoice status
export function invoiceStatus(r: Row): { status: string; days_overdue: number } {
  if (r.status === "cancelled") return { status: "void", days_overdue: 0 };
  if (r.status === "paid") return { status: "paid", days_overdue: 0 };
  const overdue = r.kind === "invoice" && r.due_at && r.due_at < now() ? Math.floor((now() - r.due_at) / DAY) : 0;
  if (r.due_at && r.due_at < now() && r.kind === "invoice") return { status: "overdue", days_overdue: Math.max(1, overdue) };
  if (BigInt(r.amount_paid) > 0n) return { status: "partially_paid", days_overdue: 0 };
  return { status: "open", days_overdue: 0 };
}

export async function nextInvoiceNumber(business: string) {
  const n = (await get("SELECT COUNT(*) AS n FROM invoices WHERE business = ? AND kind = 'invoice'", business))!.n as number;
  return `INV-${String(n + 1).padStart(4, "0")}`;
}

// --------------------------------------------------------- money movements
export interface Movement {
  id: string;
  date: number;
  category: string;
  description: string;
  counterparty: string | null;
  counterparty_name: string | null;
  direction: "in" | "out" | "internal";
  gross: string;
  fee: string;
  net: string; // signed, from this account's perspective
  reference: string | null;
  tx_hash: string | null;
  event: string;
}

/** One ledger row → at most one movement for `me`. Non-money events return null. */
export async function normalize(me: string, given?: Awaited<ReturnType<typeof ledgerFor>>): Promise<Movement[]> {
  const rows = given ?? (await ledgerFor(me, { limit: 1000 }));
  const d = await dec();
  const bps = BigInt(await feeBps());
  const names = await nameIndex(me);
  const invByOnchain = new Map((await all("SELECT onchain_id, id, number, customer_name, split_id, kind FROM invoices")).map((r) => [r.onchain_id, r]));
  const out: Movement[] = [];
  for (const r of rows) {
    const e = r.data;
    const m = (category: string, description: string, counterparty: string | null, gross: bigint, net: bigint, fee = 0n, reference: string | null = null): Movement => ({
      id: r.id,
      date: r.created_at,
      category,
      description,
      counterparty,
      counterparty_name: counterparty ? names.get(counterparty) ?? null : null,
      direction: net > 0n ? "in" : net < 0n ? "out" : "internal",
      gross: fromBase(gross, d),
      fee: fromBase(fee, d),
      net: (net < 0n ? "-" : "") + usd(net, d),
      reference,
      tx_hash: r.tx_hash,
      event: r.event,
    });
    const amt = (v: any) => BigInt(v ?? 0);
    switch (r.event) {
      case "invoice_paid":
      case "invoice_partially_paid": {
        const inv = invByOnchain.get(e.invoice_id);
        const gross = amt(e.amount);
        if (e.business === me) {
          const fee = (gross * bps) / 10000n;
          const shares = (await splitRecipients(inv?.split_id)).reduce((s, x) => s + ((gross - fee) * BigInt(x.bps)) / 10000n, 0n);
          const who = inv?.customer_name ?? e.payer;
          const label = inv?.kind === "checkout" ? "Checkout payment" : `Payment for ${inv?.number ?? `invoice #${e.invoice_id}`}`;
          const mv = m(inv?.kind === "checkout" ? "Sales" : "Customer payments", `${label}${who ? ` · ${who}` : ""}`, e.payer, gross, gross - fee - shares, fee + shares, inv?.id ?? null);
          // Cross-chain payments arrive via our settlement account: show how the customer actually paid.
          const via = e.payer === config.relayerAccountId && inv ? await intentLabel(inv.id) : null;
          if (via) {
            mv.counterparty = null;
            mv.counterparty_name = via;
          }
          out.push(mv);
        } else if (e.payer === me) {
          out.push(m("Vendor payments", `Paid invoice #${e.invoice_id} · ${names.get(e.business) ?? e.business}`, e.business, gross, -gross));
        }
        break;
      }
      case "payroll_run": {
        if (e.employer === me) out.push(m("Payroll", `${e.reference || "Payroll"} · ${e.count} ${e.count === 1 ? "person" : "people"}`, null, amt(e.total), -amt(e.total), 0n, r.id));
        else {
          const mine = (e.entries ?? []).find((x: any) => x.account_id === me);
          if (mine) out.push(m("Salary", `Salary from ${names.get(e.employer) ?? e.employer}`, e.employer, amt(mine.amount), amt(mine.amount)));
        }
        break;
      }
      case "stream_created":
        if (e.employer === me) out.push(m("Payroll", `Salary stream funded · ${names.get(e.employee) ?? e.employee}`, e.employee, amt(e.total), -amt(e.total)));
        break;
      case "stream_cancelled":
        if (r.actor === me && amt(e.refunded) > 0n) out.push(m("Payroll", `Salary stream stopped · unearned refund`, null, amt(e.refunded), amt(e.refunded)));
        break;
      case "stream_withdrawn":
        if (e.employee === me) out.push(m("Salary", "Earned wages withdrawn from stream", null, amt(e.amount), amt(e.amount)));
        break;
      case "agent_payment":
      case "approval_approved": {
        const via = r.event === "agent_payment" ? "AI autopay" : "Approved";
        if (e.business === me) out.push(m("Vendor payments", `${e.memo || "Bill payment"} · ${via}`, e.recipient, amt(e.amount), -amt(e.amount)));
        else if (e.recipient === me) out.push(m("Customer payments", `Payment from ${names.get(e.business) ?? e.business}`, e.business, amt(e.amount), amt(e.amount)));
        break;
      }
      case "subscription_charged":
        if (e.merchant === me) {
          const gross = amt(e.amount);
          const fee = (gross * bps) / 10000n;
          out.push(m("Subscriptions", `Subscription · cycle ${e.cycle}`, e.subscriber, gross, gross - fee, fee));
        } else if (e.subscriber === me) out.push(m("Subscriptions", `Subscription to ${names.get(e.merchant) ?? e.merchant}`, e.merchant, amt(e.amount), -amt(e.amount)));
        break;
      case "claim_created":
        if (e.creator === me) {
          const p = await get("SELECT recipient_email, recipient_name FROM email_payouts WHERE public_key = ?", e.public_key);
          out.push(m("Payouts", `Email payout${p ? ` · ${p.recipient_name ?? p.recipient_email}` : ""}`, null, amt(e.amount), -amt(e.amount)));
        }
        break;
      case "claim_reclaimed":
        if (e.creator === me) out.push(m("Payouts", "Unclaimed payout reclaimed", null, amt(e.amount), amt(e.amount)));
        break;
      case "claim_redeemed":
        if (e.receiver_id === me) out.push(m("Payouts", `Payout claimed from ${names.get(e.creator) ?? e.creator}`, e.creator, amt(e.amount), amt(e.amount)));
        break;
      case "transfer":
        if (e.from === me) out.push(m("Transfers", `Transfer to ${names.get(e.to) ?? e.to}${e.memo ? ` · ${e.memo}` : ""}`, e.to, amt(e.amount), -amt(e.amount)));
        else if (e.to === me) out.push(m("Transfers", `Transfer from ${names.get(e.from) ?? e.from}`, e.from, amt(e.amount), amt(e.amount)));
        break;
      case "deposit":
        if (e.account_id === me) out.push({ ...m("Treasury", "Deposit to Settle treasury", null, amt(e.amount), amt(e.amount)), direction: "internal" });
        break;
      case "withdraw":
        if (e.account_id === me) out.push({ ...m("Treasury", `Withdrawal to ${e.receiver_id === me ? "your wallet" : e.receiver_id}`, e.receiver_id, amt(e.amount), -amt(e.amount)), direction: "internal" });
        break;
    }
  }
  return out;
}

/** "Paid in SOL via NEAR Intents" for invoices settled through a cross-chain deposit. */
export async function intentLabel(invoiceId: string): Promise<string | null> {
  const d = await get("SELECT origin_asset FROM intent_deposits WHERE invoice_id = ? AND settled = 1 ORDER BY updated_at DESC LIMIT 1", invoiceId);
  return d ? `Paid in ${assetSymbol(d.origin_asset)} via NEAR Intents` : null;
}

export function assetSymbol(assetId: string) {
  const id = assetId.replace(/^nep141:/, "");
  const known: Record<string, string> = { "sol.omft.near": "SOL", "btc.omft.near": "BTC", "eth.omft.near": "ETH", "wrap.near": "NEAR" };
  if (known[id]) return known[id];
  if (/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913/i.test(id)) return "USDC on Base";
  if (/0xaf88d065e77c8cc2239327c5edb3a432268e5831/i.test(id)) return "USDC on Arbitrum";
  if (/^tron-/.test(id)) return "USDT on Tron";
  return id.split(/[.-]/)[0].toUpperCase();
}

// ------------------------------------------------------------------ customers
export function customerKey(r: Row) {
  return (r.customer_email ?? r.customer_name ?? "unknown").toLowerCase();
}

export async function customers(me: string) {
  const d = await dec();
  const by = new Map<string, any>();
  for (const r of await all("SELECT * FROM invoices WHERE business = ? AND kind = 'invoice' AND status != 'cancelled'", me)) {
    const key = customerKey(r);
    const c = by.get(key) ?? { key, name: r.customer_name ?? r.customer_email ?? "Unknown customer", email: r.customer_email, outstanding: 0n, overdue: 0n, paid: 0n, invoices: 0, last_payment_at: null as number | null };
    const due = BigInt(r.amount) - BigInt(r.amount_paid);
    c.invoices += 1;
    c.paid += BigInt(r.amount_paid);
    c.outstanding += due;
    if (invoiceStatus(r).status === "overdue") c.overdue += due;
    if (r.paid_at && (!c.last_payment_at || r.paid_at > c.last_payment_at)) c.last_payment_at = r.paid_at;
    by.set(key, c);
  }
  return [...by.values()]
    .sort((a, b) => (b.outstanding > a.outstanding ? 1 : b.outstanding < a.outstanding ? -1 : 0))
    .map((c) => ({ ...c, outstanding: fromBase(c.outstanding, d), overdue: fromBase(c.overdue, d), paid: fromBase(c.paid, d) }));
}

// ------------------------------------------------------------------ AR aging
const BUCKETS = ["current", "1_30", "31_60", "61_90", "over_90"] as const;
function bucket(dueAt: number | null, created: number) {
  const days = Math.floor((now() - (dueAt ?? created)) / DAY);
  if (days <= 0) return "current";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "over_90";
}

export async function arAging(me: string) {
  const d = await dec();
  const rows = new Map<string, any>();
  const total: Record<string, bigint> = Object.fromEntries(BUCKETS.map((b) => [b, 0n]));
  for (const r of await all("SELECT * FROM invoices WHERE business = ? AND kind = 'invoice' AND status = 'open'", me)) {
    const due = BigInt(r.amount) - BigInt(r.amount_paid);
    if (due <= 0n) continue;
    const key = customerKey(r);
    const row = rows.get(key) ?? { customer: r.customer_name ?? r.customer_email ?? "Unknown", ...Object.fromEntries(BUCKETS.map((b) => [b, 0n])) };
    const b = bucket(r.due_at, r.created_at);
    row[b] += due;
    total[b] += due;
    rows.set(key, row);
  }
  const fmt = (o: any) => {
    const sum = BUCKETS.reduce((s, b) => s + o[b], 0n);
    return { ...o, ...Object.fromEntries(BUCKETS.map((b) => [b, fromBase(o[b], d)])), total: fromBase(sum, d) };
  };
  return { buckets: BUCKETS, rows: [...rows.values()].map(fmt), total: fmt({ customer: "Total", ...total }) };
}

// ------------------------------------------------------------------ payroll
export async function payRuns(me: string) {
  const d = await dec();
  const names = await nameIndex(me);
  return (await ledgerFor(me, { events: ["payroll_run"], limit: 500 }))
    .filter((r) => r.data.employer === me)
    .map((r) => ({
      id: r.id,
      date: r.created_at,
      reference: r.data.reference ?? null,
      headcount: r.data.count,
      total: fromBase(r.data.total, d),
      status: "paid",
      tx_hash: r.tx_hash,
      lines: (r.data.entries ?? []).map((e: any) => ({ account_id: e.account_id, name: names.get(e.account_id) ?? null, amount: fromBase(e.amount, d) })),
    }));
}

// ------------------------------------------------------------------ summary
export async function summary(me: string) {
  const d = await dec();
  // All chain reads in parallel: on a slow RPC, sequential reads multiply latency.
  const [balances, approvals, streams, walletBal] = await Promise.all([
    view<[string, string][]>("get_balances", { account_id: me }),
    view<any[]>("get_approvals", { business: me, status: "pending" }).catch(() => []),
    view<any[]>("get_streams", { account_id: me }).catch(() => []),
    view<string>("ft_balance_of", { account_id: me }, config.defaultTokenId).catch(() => "0"),
    feeBps(),
  ]);
  const cash = BigInt(balances.find(([t]) => t === config.defaultTokenId)?.[1] ?? "0");
  const wallet = BigInt(walletBal ?? "0");

  const invoices = await all("SELECT * FROM invoices WHERE business = ? AND kind = 'invoice' AND status = 'open'", me);
  let ar = 0n,
    arOverdue = 0n;
  const overdueList: any[] = [];
  for (const r of invoices) {
    const due = BigInt(r.amount) - BigInt(r.amount_paid);
    ar += due;
    const st = invoiceStatus(r);
    if (st.status === "overdue") {
      arOverdue += due;
      overdueList.push({ id: r.id, number: r.number, customer: r.customer_name, amount_due: fromBase(due, d), days_overdue: st.days_overdue });
    }
  }

  const horizon = new Date((now() + 14 * DAY) * 1000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const openBills = await all("SELECT * FROM bills WHERE account_id = ? AND status IN ('needs_review','ready','pending_approval')", me);
  let apDue = 0n,
    apOverdue = 0n;
  for (const b of openBills) {
    const amount = BigInt(Math.round(Number(b.amount || 0) * 10 ** d));
    if (!b.due_date || b.due_date <= horizon) apDue += amount;
    if (b.due_date && b.due_date < today) apOverdue += amount;
  }

  const movements = await normalize(me, await ledgerFor(me, { since: now() - 30 * DAY, limit: 1000 }));
  let inflow = 0n,
    outflow = 0n;
  for (const m of movements) {
    if (m.direction === "internal") continue;
    const v = BigInt(Math.round(Number(m.net) * 10 ** d));
    if (v > 0n) inflow += v;
    else outflow += -v;
  }

  const myStreams = streams.filter((s) => s.employer === me && s.cancelled_at === null);
  const monthlyBurn = myStreams.reduce((s, x) => s + (BigInt(x.total) * BigInt(30 * DAY)) / BigInt(x.duration_secs), 0n);
  const reserved = myStreams.reduce((s, x) => s + BigInt(x.total) - BigInt(x.accrued), 0n);
  const runs = await payRuns(me);
  const unclaimed = (await all("SELECT amount FROM email_payouts WHERE account_id = ? AND status = 'sent'", me)).reduce((s, p) => s + Number(p.amount), 0);

  return {
    currency: (await tokenInfo(config.defaultTokenId)).symbol,
    cash: fromBase(cash, d),
    wallet: fromBase(wallet, d),
    receivables: { outstanding: fromBase(ar, d), overdue: fromBase(arOverdue, d), open_count: invoices.length, overdue_count: overdueList.length },
    payables: { due_14d: fromBase(apDue, d), overdue: fromBase(apOverdue, d), open_count: openBills.length },
    cash_flow_30d: { inflow: fromBase(inflow, d), outflow: fromBase(outflow, d), net: (inflow >= outflow ? "" : "-") + usd(inflow - outflow, d) },
    attention: {
      approvals: approvals.map((a) => ({ id: a.id, recipient: a.recipient, amount: fromBase(a.amount, d), memo: a.memo, reasons: a.reasons })),
      bills_to_review: openBills.filter((b) => b.status === "needs_review").map((b) => ({ id: b.id, vendor: b.vendor_name, amount: b.amount, flags: parseJson(b.risk_flags, []) })),
      overdue_invoices: overdueList.sort((a, b) => b.days_overdue - a.days_overdue),
    },
    aging: (await arAging(me)).total,
    payroll: {
      last_run: runs[0] ? { date: runs[0].date, total: runs[0].total, headcount: runs[0].headcount, reference: runs[0].reference } : null,
      streaming_monthly: fromBase(monthlyBurn, d),
      reserved_in_streams: fromBase(reserved, d),
      active_streams: myStreams.length,
      unclaimed_payouts: unclaimed.toFixed(2),
    },
  };
}
