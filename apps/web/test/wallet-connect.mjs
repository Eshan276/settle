// Simulates the "Connect with MyNearWallet" round trip against testnet:
//   1. clicks Connect and checks the wallet URL (success_url, failure_url, public_key)
//   2. plays the wallet's part: adds that public key to a real testnet account as a full-access key
//   3. lands on the success_url the way the wallet would, and checks Settle adopts the key and finishes setup
//   4. checks the cancelled path shows a clear message
import puppeteer from "puppeteer-core";
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";

const W = process.env.SETTLE_WEB ?? "http://localhost:3000";
const A = process.env.SETTLE_API ?? "http://localhost:4000";
const cfg = await (await fetch(`${A}/v1/config`)).json();

// An existing NEAR account that isn't a Settle business yet (stands in for the user's own wallet account).
const owner = KeyPair.fromRandom("ed25519");
const username = `wc${Math.random().toString(36).slice(2, 8)}`;
const created = await (await fetch(`${A}/v1/accounts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, public_key: owner.getPublicKey().toString() }) })).json();
const accountId = created.account_id;
console.log("account", accountId);
const rpc = new JsonRpcProvider({ url: cfg.rpc_url });
for (let i = 0; i < 20 && !(await rpc.viewAccount({ accountId }).then(() => true, () => false)); i++) await new Promise((r) => setTimeout(r, 1000));

const b = await puppeteer.launch({ executablePath: "/bin/google-chrome-stable", headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
const waitText = (t, timeout = 90000) => p.waitForFunction((t) => document.body.innerText.includes(t), { timeout, polling: 300 }, t);
const clickText = (t) => p.evaluate((t) => [...document.querySelectorAll("button,[role=tab],summary")].find((e) => e.innerText.trim().includes(t)).click(), t);

// 1 — Connect button builds the wallet URL
await p.goto(`${W}/dashboard`, { waitUntil: "networkidle0" });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: "networkidle0" });
await waitText("Get started");
await clickText("Use existing");
await waitText("Connect with MyNearWallet");
await p.screenshot({ path: "/tmp/settle-shots/wc-1-use-existing.png" });
await p.setRequestInterception(true);
let walletUrl;
const onReq = (r) => {
  if (r.isInterceptResolutionHandled()) return;
  if (r.url().includes("mynearwallet.com")) { walletUrl = r.url(); r.abort(); } else r.continue();
};
p.on("request", onReq);
await clickText("Connect with MyNearWallet");
for (let i = 0; i < 50 && !walletUrl; i++) await new Promise((r) => setTimeout(r, 100));
p.off("request", onReq);
await p.setRequestInterception(false);
const u = new URL(walletUrl);
const pk = u.searchParams.get("public_key");
console.log("wallet url:", u.origin + u.pathname, "success:", u.searchParams.get("success_url"), "failure:", u.searchParams.get("failure_url"), "pk:", pk?.slice(0, 18) + "…");
if (!pk || u.searchParams.get("contract_id")) throw new Error("bad wallet url");

// 2 — the wallet adds the key
await new Account(accountId, rpc, owner.toString()).addFullAccessKey(pk);
console.log("wallet added key");

// 3 — redirect back like the wallet does
await p.goto(`${u.searchParams.get("success_url")}?account_id=${accountId}&public_key=${encodeURIComponent(pk)}&all_keys=${encodeURIComponent(owner.getPublicKey().toString())}`, { waitUntil: "domcontentloaded" });
await waitText("Finish setup");
await waitText(accountId);
if (p.url().includes("account_id")) throw new Error("query not stripped");
await p.screenshot({ path: "/tmp/settle-shots/wc-2-finish.png" });
await p.type("input[autocomplete=organization]", "Wallet Test Co");
await clickText("Create business account");
await waitText("Needs you", 180000);
await p.screenshot({ path: "/tmp/settle-shots/wc-3-dashboard.png" });
console.log("✓ business created via wallet-approved key");

// 4 — cancelled
await p.evaluate(() => localStorage.clear());
await p.goto(`${W}/dashboard?connect=cancelled`, { waitUntil: "domcontentloaded" });
await waitText("cancelled");
await p.screenshot({ path: "/tmp/settle-shots/wc-4-cancelled.png" });
console.log("✓ cancel path");
console.log("errors:", errs);
await b.close();
