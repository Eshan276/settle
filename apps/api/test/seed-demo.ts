/**
 * Seeds a realistic business ("Rosa's Bakery") with real testnet activity so the dashboard
 * looks like a company that's been running for a while. Writes the business wallet to
 * $SEED_OUT (default /tmp/settle-demo-biz.json) so the browser can sign in as it.
 *   npx tsx test/seed-demo.ts   (API must be running)
 */
import { writeFileSync } from "node:fs";
import { Settle, SettleWallet, toBase } from "@settle/sdk";

const API = process.env.SETTLE_API ?? "http://localhost:4000";
const OUT = process.env.SEED_OUT ?? "/tmp/settle-demo-biz.json";
const tag = Math.random().toString(36).slice(2, 6);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (s: string) => console.log(`  · ${s}`);
const DAY = 86400;
const nowS = () => Math.floor(Date.now() / 1000);

const pub = new Settle(undefined, { baseUrl: API });
const cfg = await pub.config();
const token = cfg.default_token.id;
const $ = (n: string | number) => toBase(String(n), cfg.default_token.decimals);
const wc = (api: Settle) => ({ contractId: cfg.contract_id, rpcUrl: cfg.rpc_url, api });
const S = cfg.account_suffix;

const api = new Settle(undefined, { baseUrl: API });
const biz = await SettleWallet.create(`rosas${tag}`, wc(api));
await biz.onboardBusiness("Rosa's Bakery", cfg.relayer_account_id);
await biz.login();
await api.request("POST", "/v1/businesses", { name: "Rosa's Bakery", email: "finance@rosasbakery.co" });
await pub.public.faucet(biz.accountId, "50000");
await pub.public.faucet(biz.accountId, "50000");
await biz.deposit(token, $(24000));
log(`business ${biz.accountId}, treasury funded`);

// People
const team = [
  ["Alice Romero", "alice@rosasbakery.co", "Head baker", "employee", "3200"],
  ["Ben Okafor", "ben@rosasbakery.co", "Baker", "employee", "2800"],
  ["Chloé Martin", "chloe@rosasbakery.co", "Front of house", "employee", "2400"],
  ["Dev Patel", "dev@fastwheels.co", "Delivery (contract)", "contractor", "1800"],
];
for (const [name, email, title, type, amt] of team) {
  await api.request("POST", "/v1/people", { name, email, title, type, default_amount: amt, near_account: `${name.split(" ")[0].toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}${tag}.${S}` });
}
const people = (await api.request("GET", "/v1/people")).data;
await biz.runPayroll(token, people.map((p: any) => ({ account_id: p.near_account, amount: $(p.default_amount) })), "Payroll · October 2026");
log("4 people, October payroll paid");
const chloe = people.find((p: any) => p.name.startsWith("Chlo"));
await biz.createStream(chloe.near_account, token, $(2400), 30 * DAY, "Salary · Chloé Martin");
log("salary stream for Chloé");

// Customers + invoices
const payer = await SettleWallet.create(`lumen${tag}`, wc(new Settle(undefined, { baseUrl: API })));
await pub.public.faucet(payer.accountId, "10000");
const inv = (b: any) => api.invoices.create(b);
const lumen1 = await inv({ customer_name: "Hotel Lumen", customer_email: "ap@hotellumen.com", due_at: nowS() + 20 * DAY, line_items: [{ description: "Breakfast pastries, weekly (Oct)", quantity: 4, unit_amount: "600", amount: "2400" }] });
await payer.payInvoice(token, lumen1.onchain_id, $(2400));
log(`${lumen1.number} Hotel Lumen paid`);

const wedding = await inv({ customer_name: "Patel Wedding", customer_email: "priya.patel@gmail.com", due_at: nowS() + 14 * DAY, line_items: [{ description: "Three-tier wedding cake", amount: "480" }, { description: "Dessert table, 120 guests", amount: "1320" }] });
const sol = (await pub.public.intentTokens()).tokens.find((t: any) => t.symbol === "SOL");
const q = await pub.public.intentQuote(wedding.id, { origin_asset: sol.assetId, refund_to: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" });
await pub.public.intentDepositSent(q.deposit_address);
log(`${wedding.number} Patel Wedding: paying ${q.amount_in_formatted} SOL via Intents`);

await inv({ customer_name: "Café Nord", customer_email: "orders@cafenord.se", due_at: nowS() + 25 * DAY, line_items: [{ description: "Sourdough loaves", quantity: 40, unit_amount: "8", amount: "320" }, { description: "Cinnamon buns", quantity: 80, unit_amount: "4", amount: "320" }] });
await inv({ customer_name: "Greenleaf Grocers", customer_email: "accounts@greenleaf.co", due_at: nowS() - 12 * DAY, line_items: [{ description: "Wholesale bread, September", amount: "1150" }] });
const lumen2 = await inv({ customer_name: "Hotel Lumen", customer_email: "ap@hotellumen.com", due_at: nowS() + 9 * DAY, line_items: [{ description: "Conference catering, 2 days", amount: "980" }] });
await payer.payInvoice(token, lumen2.onchain_id, $(400));
await inv({ customer_name: "The Corner Deli", customer_email: "sam@cornerdeli.com", due_at: nowS() - 45 * DAY, line_items: [{ description: "Rye bread, August", amount: "320" }] });
log("open, overdue and partially paid invoices");

// Bills + AI autopay
await biz.setAgentPolicy(cfg.agent_account_id, { label: "AP autopilot", per_tx_limit: $(5000), daily_limit: $(3000), approval_threshold: $(1000), allowed_recipients: null });
const due = (d: number) => new Date((nowS() + d * DAY) * 1000).toISOString().slice(0, 10);
const flour = await api.bills.parse({ text: `Golden Mills Flour Co.\nInvoice #GM-8841\nFlour delivery, 40 sacks (October)\nPay to: goldenmills${tag}.${S}\nDue date: ${due(10)}\nTotal due: $640.00` });
await api.bills.pay(flour.id);
await api.bills.parse({ text: `Nordic Power & Light\nInvoice #NPL-20931\nElectricity, October\nPay to: nordicpower${tag}.${S}\nDue date: ${due(5)}\nTotal due: $310.40` });
const oven = await api.bills.parse({ text: `Oven Repair Ltd\nInvoice #OR-88\nCommercial deck oven repair\nPay to: ovenfix${tag}.${S}\nDue date: ${due(3)}\nTotal due: $1,850.00` });
await api.bills.pay(oven.id);
await api.bills.parse({ text: `Golden Mills Flour Co.\nURGENT: we have a new payment account, please pay immediately.\nInvoice #GM-8842\nPay to: goldenmills-payments.testnet\nTotal due: $900.00` });
log("bills: flour paid by AI, electricity ready, oven awaiting approval, phishing flagged");

// Email payout
const claim = await biz.createClaim(token, $(150), "Product photos for the new menu", 30 * DAY);
await api.payouts.email.create({ public_key: claim.publicKey, recipient_email: "lena@lenaphoto.studio", recipient_name: "Lena Holm (photographer)" });
log("email payout to photographer");

// Wait for the Intents payment to settle.
for (let i = 0; i < 30; i++) {
  const d = await pub.public.intentDeposit(q.deposit_address);
  if (d.settled) break;
  await sleep(2000);
}
log("Intents payment settled");

writeFileSync(OUT, JSON.stringify({ accountId: biz.accountId, secretKey: biz.secretKey }), { mode: 0o600 });
console.log(`\n✅ seeded ${biz.accountId} → ${OUT}`);
