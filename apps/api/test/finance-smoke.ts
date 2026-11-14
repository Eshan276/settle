/**
 * Smoke test for the finance layer against live testnet: creates real activity, then checks
 * that invoices/customers/transactions/payroll/summary/reports reflect it and reconcile.
 *   pnpm --filter @settle/api tsx test/finance-smoke.ts   (API must be running)
 */
import assert from "node:assert/strict";
import { Settle, SettleWallet, toBase } from "@settle/sdk";

const API = process.env.SETTLE_API ?? "http://localhost:4000";
const rnd = () => Math.random().toString(36).slice(2, 7);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (s: string) => console.log(`  ✓ ${s}`);

const pub = new Settle(undefined, { baseUrl: API });
const cfg = await pub.config();
const token = cfg.default_token.id;
const $ = (n: string) => toBase(n, cfg.default_token.decimals);
const wc = (api: Settle) => ({ contractId: cfg.contract_id, rpcUrl: cfg.rpc_url, api });

const api = new Settle(undefined, { baseUrl: API });
const biz = await SettleWallet.create(`fin${rnd()}`, wc(api));
await biz.onboardBusiness("Finance Smoke Co", cfg.relayer_account_id);
await biz.login();
await api.request("POST", "/v1/businesses", { name: "Finance Smoke Co" });
await pub.public.faucet(biz.accountId, "5000");
await biz.deposit(token, $("3000"));
ok(`business ${biz.accountId}`);

// Receivables: one paid, one open (Net 30), one overdue.
const paid = await api.invoices.create({ customer_name: "Jane's Café", customer_email: "ap@cafe.test", line_items: [{ description: "Bread", amount: "200" }] });
const open = await api.invoices.create({ customer_name: "Jane's Café", customer_email: "ap@cafe.test", line_items: [{ description: "Cakes", amount: "150" }] });
const late = await api.invoices.create({ customer_name: "Hotel Lumen", customer_email: "ap@lumen.test", due_at: Math.floor(Date.now() / 1000) - 10 * 86400, line_items: [{ description: "Pastries", amount: "90" }] });
assert.match(paid.number, /^INV-\d{4}$/);
assert.ok(open.due_at > Date.now() / 1000 + 29 * 86400, "Net 30 default");
const payer = await SettleWallet.create(`payer${rnd()}`, wc(new Settle(undefined, { baseUrl: API })));
await pub.public.faucet(payer.accountId, "1000");
await payer.payInvoice(token, paid.onchain_id, $("200"));
await sleep(2000);
ok(`invoices ${paid.number} (paid), ${open.number} (open), ${late.number} (overdue)`);

const list = await api.request("GET", "/v1/receivables/invoices?tab=all");
assert.equal(list.counts.paid, 1);
assert.equal(list.counts.overdue, 1);
assert.equal(list.counts.outstanding, 2);
assert.equal(list.data.find((i: any) => i.id === late.id).display_status, "overdue");
ok(`invoice tabs: ${JSON.stringify(list.counts)}`);

const tl = await api.request("GET", `/v1/invoices/${paid.id}/timeline`);
assert.ok(tl.data.some((t: any) => t.type === "payment" && t.proof_url), "payment with proof on timeline");
assert.equal(tl.payments[0].net, "199"); // 0.5% fee
ok(`timeline: ${tl.data.map((t: any) => t.type).join(" → ")} · net ${tl.payments[0].net} fee ${tl.payments[0].fee}`);

const cust = await api.request("GET", "/v1/customers");
const jane = cust.data.find((c: any) => c.name === "Jane's Café");
assert.equal(jane.outstanding, "150");
assert.equal(jane.paid, "200");
ok(`customers: ${cust.data.map((c: any) => `${c.name} owes ${c.outstanding}`).join(", ")}`);

// People + payroll
const alice = await api.request("POST", "/v1/people", { name: "Alice Romero", near_account: `alice${rnd()}.${cfg.account_suffix}`, title: "Head baker", default_amount: "1200" });
const imp = await api.request("POST", "/v1/people/import", { csv: `name,email,near_account,amount\nBen Okafor,ben@x.test,ben${rnd()}.${cfg.account_suffix},900` });
assert.equal(imp.created, 1);
const people = (await api.request("GET", "/v1/people")).data;
await biz.runPayroll(token, people.map((p: any) => ({ account_id: p.near_account, amount: $(p.default_amount) })), "Payroll Nov 2026");
const runs = (await api.request("GET", "/v1/payroll/runs")).data;
assert.equal(runs[0].total, "2100");
assert.ok(runs[0].lines.every((l: any) => l.name), "lines resolve to people names");
ok(`pay run: ${runs[0].headcount} people · ${runs[0].total} · ${runs[0].lines.map((l: any) => l.name).join(", ")}`);
const ppl = (await api.request("GET", "/v1/people")).data;
assert.equal(ppl.find((p: any) => p.id === alice.id).paid_ytd, "1200.00");

// Transactions + summary
const tx = (await api.request("GET", "/v1/transactions")).data;
const cats = tx.map((t: any) => `${t.category}:${t.net}`);
assert.ok(tx.some((t: any) => t.category === "Customer payments" && t.net === "199"));
assert.ok(tx.some((t: any) => t.category === "Payroll" && t.net === "-2100"));
assert.ok(tx.some((t: any) => t.category === "Treasury" && t.direction === "internal"));
ok(`transactions: ${cats.join(", ")}`);

const s = await api.request("GET", "/v1/summary");
assert.equal(s.receivables.outstanding, "240");
assert.equal(s.receivables.overdue, "90");
assert.equal(s.cash_flow_30d.net, "-1901"); // +199 in, -2100 payroll; deposit excluded
assert.equal(s.cash, "1099"); // 3000 + 199 - 2100
ok(`summary: cash ${s.cash}, AR ${s.receivables.outstanding} (${s.receivables.overdue} overdue), 30d net ${s.cash_flow_30d.net}`);

// Reports
for (const r of ["/v1/reports/ar-aging?format=csv", "/v1/reports/payroll-register?format=csv", "/v1/transactions?format=csv", "/v1/reports/cash-flow?format=csv"]) {
  const res = await fetch(`${API}${r}`, { headers: { authorization: `Bearer ${(api as any).token}` } });
  const text = await res.text();
  assert.equal(res.status, 200, r);
  assert.ok(text.split("\n").length >= 2, `${r} has rows`);
}
ok("reports: AR aging, payroll register, transactions, cash flow CSVs");
console.log("\n✅ finance layer reconciles");
